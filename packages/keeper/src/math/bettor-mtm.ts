/**
 * Bettor position mark-to-market (MTM) computation.
 *
 * For house strategies (①②③), bettor_mtm = 0 (no bettor positions).
 * For bettor strategies (⑤⑥⑦), the MTM is the sum of current payout values
 * for all open positions, computed via predict::get_trade_amounts.
 *
 * The predict-server currently does not expose an open-positions endpoint
 * for a specific manager. We use DevInspect on get_trade_amounts for each
 * known open position tracked in the keeper DB.
 *
 * For Phase 4, house strategies dominate the portfolio set. Bettor MTM
 * returns 0n for portfolios with no open bettor positions, which is correct.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { env, CLOCK_ID } from '../env.js';
import { log } from '../logger.js';

const PREDICT_PKG = () => env.PREDICT_PACKAGE;
const PREDICT_OBJ = () => env.PREDICT_OBJECT;
const DUSDC       = env.DUSDC_TYPE;

export interface OpenBettorPosition {
  key: string;
  quantity_raw: bigint;
  position_type: 'binary' | 'range';
}

/**
 * Compute the sum of current payout values for all open bettor positions.
 *
 * For each position, calls predict::get_trade_amounts(oracle, key, quantity)
 * and sums the bid (current value if sold now).
 *
 * Returns 0n if positions is empty (no bettor positions open = no MTM).
 */
export async function computeBettorMtm(
  client: SuiGrpcClient,
  sender: string,
  managerId: string,
  oracleId: string,
  positions: OpenBettorPosition[],
): Promise<bigint> {
  if (positions.length === 0) return 0n;

  let total_mtm = 0n;

  for (const pos of positions) {
    try {
      const mtm = await readPositionMtm(client, sender, managerId, oracleId, pos);
      total_mtm += mtm;
    } catch (err) {
      log.warn({ managerId, key: pos.key, err }, 'get_trade_amounts failed for position, using 0');
    }
  }

  return total_mtm;
}

async function readPositionMtm(
  client: SuiGrpcClient,
  sender: string,
  managerId: string,
  oracleId: string,
  pos: OpenBettorPosition,
): Promise<bigint> {
  const tx = new Transaction();
  tx.setSender(sender);

  // predict::get_trade_amounts<DUSDC>(predict, oracle, manager, key, quantity, clock)
  // Returns (bid: u64, ask: u64) — we use bid (current sell value) as MTM.
  tx.moveCall({
    target: `${PREDICT_PKG()}::predict::get_trade_amounts`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(PREDICT_OBJ()),
      tx.object(oracleId),
      tx.object(managerId),
      tx.pure.string(pos.key),
      tx.pure.u64(pos.quantity_raw),
      tx.object(CLOCK_ID),
    ],
  });

  const sim = await client.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true },
  });

  if (sim.$kind === 'FailedTransaction') {
    throw new Error(`get_trade_amounts failed: ${JSON.stringify(sim.FailedTransaction?.status)}`);
  }

  // Returns (bid, ask) — returnValues[0] is bid.
  const bcs = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bcs) return 0n;
  return Buffer.from(bcs).readBigUInt64LE(0) as unknown as bigint;
}
