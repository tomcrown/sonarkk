/**
 * Settlement of prior positions via redeem_permissionless / redeem_range.
 *
 * Binary positions: redeem_permissionless — no owner check required.
 * Range positions: redeem_range — same; keeper tracks open positions in DB.
 *
 * Actual on-chain signatures (verified 2026-06-15):
 *   redeem_permissionless<Q>(predict, manager, oracle, key: MarketKey, amount, clock, ctx) → void
 *   redeem_range<Q>(predict, manager, oracle, key: RangeKey, amount, clock, ctx) → void
 *
 * Both return void. The payout is added to the PredictManager's internal balance.
 * After redemption, we call predict_manager::balance → withdraw → store_quote to
 * return all accumulated funds (payout + any leftover premium) to the portfolio.
 *
 * Key reconstruction from DB-stored market key strings:
 *   "binary|{oracle_id}|{expiry_ms}|{strike_raw}|{call/put}"
 *     → market_key::up/down(oracle_id: ID, expiry: u64, strike: u64) → MarketKey
 *   "range|{oracle_id}|{expiry_ms}|{lower_strike_raw}|{upper_strike_raw}"
 *     → range_key::new(oracle_id: ID, expiry: u64, lower: u64, upper: u64) → RangeKey
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { env, CLOCK_ID } from '../env.js';
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

// ── Key parsing ───────────────────────────────────────────────────────────────

interface ParsedBinaryKey {
  oracleId: string;
  expiryMs: bigint;
  strikeRaw: bigint;
  isCall: boolean;
}

interface ParsedRangeKey {
  oracleId: string;
  expiryMs: bigint;
  lowerStrikeRaw: bigint;
  upperStrikeRaw: bigint;
}

function parseBinaryKey(key: string): ParsedBinaryKey {
  // "binary|{oracle_id}|{expiry_ms}|{strike_raw}|{call/put}"
  const parts = key.split('|');
  if (parts.length !== 5 || parts[0] !== 'binary') {
    throw new Error(`invalid binary key format: ${key}`);
  }
  return {
    oracleId: parts[1]!,
    expiryMs: BigInt(parts[2]!),
    strikeRaw: BigInt(parts[3]!),
    isCall: parts[4] === 'call',
  };
}

function parseRangeKey(key: string): ParsedRangeKey {
  // "range|{oracle_id}|{expiry_ms}|{lower_strike_raw}|{upper_strike_raw}"
  const parts = key.split('|');
  if (parts.length !== 5 || parts[0] !== 'range') {
    throw new Error(`invalid range key format: ${key}`);
  }
  return {
    oracleId: parts[1]!,
    expiryMs: BigInt(parts[2]!),
    lowerStrikeRaw: BigInt(parts[3]!),
    upperStrikeRaw: BigInt(parts[4]!),
  };
}

// ── Binary settlement ─────────────────────────────────────────────────────────

/**
 * Settle binary positions that matured at the given oracle.
 *
 * redeem_permissionless settles for any caller; no ownership check.
 * After all redeems, withdraws the full manager balance back into the portfolio.
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
    const rawKey = marketKeys[i]!;
    const qty    = quantities[i]!;
    const parsed = parseBinaryKey(rawKey);

    // Build MarketKey struct: market_key::up/down(oracle_id: ID, expiry: u64, strike: u64)
    const onchainKey = tx.moveCall({
      target: `${PREDICT_PKG()}::market_key::${parsed.isCall ? 'up' : 'down'}`,
      typeArguments: [],
      arguments: [
        tx.pure.id(parsed.oracleId),
        tx.pure.u64(parsed.expiryMs),
        tx.pure.u64(parsed.strikeRaw),
      ],
    });

    // redeem_permissionless → void; payout added to manager's internal balance.
    tx.moveCall({
      target: `${PREDICT_PKG()}::predict::redeem_permissionless`,
      typeArguments: [DUSDC],
      arguments: [
        tx.object(PREDICT_OBJ()),
        tx.object(managerId),
        tx.object(oracleId),
        onchainKey,
        tx.pure.u64(qty),
        tx.object(CLOCK_ID),
      ],
    });
  }

  // After all redeems, read manager balance and withdraw everything.
  const bal = tx.moveCall({
    target: `${PREDICT_PKG()}::predict_manager::balance`,
    typeArguments: [],
    arguments: [tx.object(managerId)],
  });
  const payoutCoin = tx.moveCall({
    target: `${PREDICT_PKG()}::predict_manager::withdraw`,
    typeArguments: [DUSDC],
    arguments: [tx.object(managerId), bal],
  });
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::store_quote`,
    typeArguments: [DUSDC],
    arguments: [tx.object(portfolioId), payoutCoin],
  });

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
  log.info({ digest, portfolioId, oracleId, count: marketKeys.length }, 'binary positions settled');

  return { tx_digest: digest, positions_settled: marketKeys.length, payout_raw: 0n };
}

// ── Range settlement ──────────────────────────────────────────────────────────

/**
 * Settle range positions for the given oracle.
 *
 * redeem_range requires the manager and oracle to match the position key.
 * After all redeems, withdraws full manager balance into the portfolio.
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
    const rawKey = rangeKeys[i]!;
    const qty    = quantities[i]!;
    const parsed = parseRangeKey(rawKey);

    // Build RangeKey struct: range_key::new(oracle_id: ID, expiry: u64, lower: u64, upper: u64)
    const onchainKey = tx.moveCall({
      target: `${PREDICT_PKG()}::range_key::new`,
      typeArguments: [],
      arguments: [
        tx.pure.id(parsed.oracleId),
        tx.pure.u64(parsed.expiryMs),
        tx.pure.u64(parsed.lowerStrikeRaw),
        tx.pure.u64(parsed.upperStrikeRaw),
      ],
    });

    // redeem_range → void; payout added to manager's internal balance.
    tx.moveCall({
      target: `${PREDICT_PKG()}::predict::redeem_range`,
      typeArguments: [DUSDC],
      arguments: [
        tx.object(PREDICT_OBJ()),
        tx.object(managerId),
        tx.object(oracleId),
        onchainKey,
        tx.pure.u64(qty),
        tx.object(CLOCK_ID),
      ],
    });
  }

  // Withdraw all manager balance (payout + any leftover premium) into portfolio.
  const bal = tx.moveCall({
    target: `${PREDICT_PKG()}::predict_manager::balance`,
    typeArguments: [],
    arguments: [tx.object(managerId)],
  });
  const payoutCoin = tx.moveCall({
    target: `${PREDICT_PKG()}::predict_manager::withdraw`,
    typeArguments: [DUSDC],
    arguments: [tx.object(managerId), bal],
  });
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::store_quote`,
    typeArguments: [DUSDC],
    arguments: [tx.object(portfolioId), payoutCoin],
  });

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
