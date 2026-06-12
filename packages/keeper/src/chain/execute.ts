/**
 * Portfolio cycle execution — builds and submits the keeper PTB.
 *
 * One PTB per portfolio per expiry:
 *   1. update_nav (push computed NAV per share)
 *   2. take_for_supply → predict::supply → store_lp   (house strategies ①②③)
 *   3. take_for_bettor → predict_manager::deposit → predict::mint_range  (⑤⑥)
 *
 * The hedge order (for ②) is submitted in a SEPARATE PTB via spot/hedge.ts
 * because DeepBook PTBs reference their own coin objects, which cannot be
 * combined with Predict calls in a single PTB without object ID conflicts.
 *
 * All functions that write to the portfolio require the PolicyCap to be passed.
 * Budget is consumed on-chain; the keeper cannot exceed the cap.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SizingResult } from '@sonarkk/core';
import { env, PLP_TYPE, CLOCK_ID, EXPLORER_URL } from '../env.js';
import { log } from '../logger.js';
import { withRetry } from '../util/retry.js';

const PREDICT_PKG = () => env.PREDICT_PACKAGE;
const PREDICT_OBJ = () => env.PREDICT_OBJECT;
const SONARK_PKG  = () => env.SONARK_PACKAGE;
const DUSDC       = env.DUSDC_TYPE;

export interface ExecuteResult {
  tx_digest: string;
  nav_pushed: bigint;
  supply_amount_raw: bigint;
}

/**
 * Execute the house-strategy supply cycle for a single portfolio.
 *
 * Steps:
 *   a. update_nav — commits the computed nav_per_share on-chain
 *   b. take_for_supply → predict::supply → store_lp — supply DUSDC, receive PLP
 *
 * The hedge order is NOT included here; it's submitted after this TX confirms.
 */
export async function executeSupplyCycle(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  navPerShare: bigint,
  sizing: SizingResult,
): Promise<ExecuteResult> {
  const supplyAmount = sizing.size_raw;
  if (supplyAmount <= 0n) {
    throw new Error('executeSupplyCycle called with zero supply amount');
  }

  const tx = new Transaction();

  // 1. Push NAV per share so the deposit contract can price new shares correctly.
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::update_nav`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(navPerShare),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 2. Take DUSDC from portfolio → supply to Predict → get PLP → store back.
  const dusdc_coin = tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::take_for_supply`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(supplyAmount),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  const plp_coin = tx.moveCall({
    target: `${PREDICT_PKG()}::predict::supply`,
    typeArguments: [DUSDC],
    arguments: [tx.object(PREDICT_OBJ()), dusdc_coin, tx.object(CLOCK_ID)],
  });

  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::store_lp`,
    typeArguments: [DUSDC, PLP_TYPE],
    arguments: [
      tx.object(portfolioId),
      plp_coin,
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `executeSupplyCycle(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`supply TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  log.info(
    { digest, portfolioId, navPerShare: navPerShare.toString(), supplyAmount: supplyAmount.toString(),
      explorer: `${EXPLORER_URL}/${digest}` },
    'supply cycle executed',
  );

  return { tx_digest: digest, nav_pushed: navPerShare, supply_amount_raw: supplyAmount };
}

/**
 * Push updated NAV without supplying (e.g. when entry guard fires skip).
 * Keeps the on-chain NAV fresh so deposits can proceed.
 */
export async function pushNavOnly(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  navPerShare: bigint,
): Promise<string> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::update_nav`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(navPerShare),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `pushNavOnly(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`update_nav TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }
  return result.Transaction?.digest ?? '';
}
