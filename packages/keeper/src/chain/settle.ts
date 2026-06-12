/**
 * Settlement of prior positions via redeem_permissionless.
 *
 * Binary positions: redeem_permissionless — no owner check required.
 * Range positions: stored in the portfolio's PredictManager; the keeper calls
 *   redeem_range which requires the manager to be registered on the portfolio.
 *
 * Settlement payout flows back into portfolio.quote_balance via store_quote.
 * The keeper includes settle calls at the top of the per-expiry PTB.
 *
 * For Phase 4, binary settlement is implemented; range settlement requires
 * the keeper to track open range positions (MarketKey + quantity). The keeper
 * stores these in the DB during the mint step and reads them here on settlement.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { env, PLP_TYPE, CLOCK_ID } from '../env.js';
import { log } from '../logger.js';
import { withRetry } from '../util/retry.js';

const PREDICT_PKG = () => env.PREDICT_PACKAGE;
const PREDICT_OBJ = () => env.PREDICT_OBJECT;
const SONARK_PKG  = () => env.SONARK_PACKAGE;
const DUSDC       = env.DUSDC_TYPE;

export interface SettleResult {
  tx_digest: string | null;
  positions_settled: number;
  payout_raw: bigint;
}

/**
 * Settle all binary positions that matured at `oracleId`.
 *
 * predict::redeem_permissionless settles binary positions for any caller;
 * no ownership check is needed. It reads the oracle settlement price
 * and pays out the winner's notional.
 *
 * The payout is stored back into the portfolio via store_quote.
 * Returns null if there are no positions to settle.
 */
export async function settleBinaryPositions(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  managerId: string,
  oracleId: string,
  marketKeys: string[],
  quantities: bigint[],
): Promise<SettleResult> {
  if (marketKeys.length === 0) {
    return { tx_digest: null, positions_settled: 0, payout_raw: 0n };
  }

  const tx = new Transaction();

  for (let i = 0; i < marketKeys.length; i++) {
    const key = marketKeys[i]!;
    const qty  = quantities[i]!;

    // redeem_permissionless<DUSDC>(predict, manager, oracle, key, quantity, clock) → Coin<DUSDC>
    const payout = tx.moveCall({
      target: `${PREDICT_PKG()}::predict::redeem_permissionless`,
      typeArguments: [DUSDC],
      arguments: [
        tx.object(PREDICT_OBJ()),
        tx.object(managerId),
        tx.object(oracleId),
        tx.pure.string(key),
        tx.pure.u64(qty),
        tx.object(CLOCK_ID),
      ],
    });

    // Store payout back into the portfolio
    tx.moveCall({
      target: `${SONARK_PKG()}::portfolio::store_quote`,
      typeArguments: [DUSDC],
      arguments: [tx.object(portfolioId), payout],
    });
  }

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `settleBinaryPositions(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`settle TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  log.info({ digest, portfolioId, oracleId, count: marketKeys.length }, 'positions settled');

  return { tx_digest: digest, positions_settled: marketKeys.length, payout_raw: 0n };
}

/**
 * Settle all range positions for a given oracle.
 *
 * Range positions are settled via redeem_range which requires the keeper
 * to be the manager owner. The range key encodes the strike range.
 */
export async function settleRangePositions(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  managerId: string,
  oracleId: string,
  rangeKeys: string[],
  quantities: bigint[],
): Promise<SettleResult> {
  if (rangeKeys.length === 0) {
    return { tx_digest: null, positions_settled: 0, payout_raw: 0n };
  }

  const tx = new Transaction();

  for (let i = 0; i < rangeKeys.length; i++) {
    const key = rangeKeys[i]!;
    const qty  = quantities[i]!;

    // redeem_range<DUSDC>(predict, manager, oracle, key, quantity, clock) → Coin<DUSDC>
    const payout = tx.moveCall({
      target: `${PREDICT_PKG()}::predict::redeem_range`,
      typeArguments: [DUSDC],
      arguments: [
        tx.object(PREDICT_OBJ()),
        tx.object(managerId),
        tx.object(oracleId),
        tx.pure.string(key),
        tx.pure.u64(qty),
        tx.object(CLOCK_ID),
      ],
    });

    tx.moveCall({
      target: `${SONARK_PKG()}::portfolio::store_quote`,
      typeArguments: [DUSDC],
      arguments: [tx.object(portfolioId), payout],
    });
  }

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `settleRangePositions(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`range settle TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  log.info({ digest, portfolioId, oracleId, count: rangeKeys.length }, 'range positions settled');

  return { tx_digest: digest, positions_settled: rangeKeys.length, payout_raw: 0n };
}
