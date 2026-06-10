/**
 * Strategy ⑤ — Range-Roll (bettor, short-vol).
 *
 * Mints a range binary every 15-min expiry, auto-rolls.
 * Earns when BTC stays within the range; loses when BTC breaks out.
 * This is a short-vol bet: profitable when realized vol < implied vol.
 *
 * Range definition:
 *   K_low  = F × exp(-range_sigma_multiple × atm_vol × √T)
 *   K_high = F × exp(+range_sigma_multiple × atm_vol × √T)
 *   Default: ±1σ (range_sigma_multiple = 1.0) → P_range ≈ 0.68 under log-normal.
 *
 * Quant note: The spread eats into range premium; win rate must exceed the spread
 * hurdle for this to be profitable. Expected P&L = p_range - spread - p_range×spread
 * = (p_range + spread - 1) per unit notional when winning, -notional when losing.
 */
import { binaryCallProb } from '../engine/svi.js';
import { computeSpread, bettorBetPnl } from '../engine/spread.js';
import { rangeWon } from '../engine/payoff.js';
import type { OracleRecord, RoundResult } from '../data/types.js';
import type { SimConfig } from './types.js';

// ±σ multiples for range boundaries.
const RANGE_SIGMA = 1.0;

export function simulateRangeRoll(
  records: OracleRecord[],
  config: SimConfig,
): RoundResult[] {
  return records.map((rec) => {
    const active_notional = config.vault_size_dusdc * config.utilization;
    const atm_vol_sqrt_t = rec.atm_vol * Math.sqrt(rec.t_years);
    const F = rec.forward_usd;
    const S_T = rec.settlement_price_usd;

    // Range boundaries in log-moneyness.
    const k_low = -RANGE_SIGMA * atm_vol_sqrt_t;
    const k_high = RANGE_SIGMA * atm_vol_sqrt_t;
    const K_low = F * Math.exp(k_low);
    const K_high = F * Math.exp(k_high);

    // P_range = P(S_T > K_low) - P(S_T > K_high) [= P(K_low < S_T ≤ K_high)]
    const p_above_low = binaryCallProb(rec.svi, k_low);
    const p_above_high = binaryCallProb(rec.svi, k_high);
    const p_range = Math.max(0, p_above_low - p_above_high);

    const spread = computeSpread(p_range, config.utilization);
    const won = rangeWon(S_T, K_low, K_high);
    const pnl = bettorBetPnl(p_range, config.utilization, won, active_notional);

    return {
      oracle_id: rec.oracle_id,
      expiry_ms: rec.expiry_ms,
      pnl_fraction: pnl / config.vault_size_dusdc,
      spread_fraction: spread * active_notional / config.vault_size_dusdc,
      won,
    };
  });
}
