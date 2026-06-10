/**
 * Strategy ⑧ — Directional (negative control, NOT an automated strategy).
 *
 * Included as a negative control to confirm the backtest penalises bad EV.
 * Simple: always buys ATM binary call (bets BTC goes up each round).
 *
 * Expected EV per bet = -(spread) < 0. This should show up as consistently
 * negative APY and confirm the backtest penalises spread-eating strategies.
 *
 * Per CLAUDE.md §2: "up/down mint is a user's discretionary call, never marketed
 * or automated as a profit engine (negative EV as a repeated bot)."
 * This module is the proof.
 */
import { binaryCallProb } from '../engine/svi.js';
import { computeSpread, bettorBetPnl } from '../engine/spread.js';
import { binaryCallWon } from '../engine/payoff.js';
import type { OracleRecord, RoundResult } from '../data/types.js';
import type { SimConfig } from './types.js';

export function simulateDirectional(
  records: OracleRecord[],
  config: SimConfig,
): RoundResult[] {
  return records.map((rec) => {
    const active_notional = config.vault_size_dusdc * config.utilization;
    const F = rec.forward_usd;
    const S_T = rec.settlement_price_usd;

    const p_call = binaryCallProb(rec.svi, 0); // ATM call probability
    const spread = computeSpread(p_call, config.utilization);
    const won = binaryCallWon(S_T, F);
    const pnl = bettorBetPnl(p_call, config.utilization, won, active_notional);

    return {
      oracle_id: rec.oracle_id,
      expiry_ms: rec.expiry_ms,
      pnl_fraction: pnl / config.vault_size_dusdc,
      spread_fraction: spread * active_notional / config.vault_size_dusdc,
      won,
    };
  });
}
