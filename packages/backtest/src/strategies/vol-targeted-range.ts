/**
 * Strategy ⑥ — Volatility-Targeted Range.
 *
 * Like Range-Roll (⑤) but sizes the bet to target a constant portfolio volatility.
 * When implied vol is high (wide ranges, low p_range), position is smaller.
 * When implied vol is low (narrow ranges, high p_range), position is larger.
 *
 * Sizing: position_size = target_dollar_vol / sqrt(p_range × (1-p_range))
 * where target_dollar_vol = vol_target_pct × vault_size.
 *
 * The position is capped at the configured utilization fraction of the vault.
 *
 * Range definition: same ±1σ as Range-Roll.
 *
 * Quant note: Vol-targeting reduces drawdown during high-vol regimes (BTC crash)
 * and increases exposure during low-vol regimes. Sharpe ratio typically improves
 * vs fixed-size Range-Roll.
 */
import { binaryCallProb } from '../engine/svi.js';
import { computeSpread, bettorBetPnl } from '../engine/spread.js';
import { rangeWon } from '../engine/payoff.js';
import type { OracleRecord, RoundResult } from '../data/types.js';
import type { SimConfig } from './types.js';

const RANGE_SIGMA = 1.0;
// Target per-round P&L volatility as fraction of vault.
const VOL_TARGET_PCT = 0.005; // 0.5% per round target vol

export function simulateVolTargetedRange(
  records: OracleRecord[],
  config: SimConfig,
): RoundResult[] {
  return records.map((rec) => {
    const max_notional = config.vault_size_dusdc * config.utilization;
    const atm_vol_sqrt_t = rec.atm_vol * Math.sqrt(rec.t_years);
    const F = rec.forward_usd;
    const S_T = rec.settlement_price_usd;

    const k_low = -RANGE_SIGMA * atm_vol_sqrt_t;
    const k_high = RANGE_SIGMA * atm_vol_sqrt_t;
    const K_low = F * Math.exp(k_low);
    const K_high = F * Math.exp(k_high);

    const p_above_low = binaryCallProb(rec.svi, k_low);
    const p_above_high = binaryCallProb(rec.svi, k_high);
    const p_range = Math.max(0.01, p_above_low - p_above_high); // floor at 1% to avoid div/0

    // Per-unit P&L std-dev ≈ sqrt(p*(1-p)) (variance of a binary outcome)
    const per_unit_std = Math.sqrt(p_range * (1 - p_range));
    const target_dollar_vol = VOL_TARGET_PCT * config.vault_size_dusdc;
    const sized_notional = per_unit_std > 0 ? target_dollar_vol / per_unit_std : 0;
    const active_notional = Math.min(sized_notional, max_notional);

    const spread = computeSpread(p_range, config.utilization);
    const won = rangeWon(S_T, K_low, K_high);
    const pnl = active_notional > 0
      ? bettorBetPnl(p_range, config.utilization, won, active_notional)
      : 0;

    return {
      oracle_id: rec.oracle_id,
      expiry_ms: rec.expiry_ms,
      pnl_fraction: pnl / config.vault_size_dusdc,
      spread_fraction: spread * active_notional / config.vault_size_dusdc,
      won,
    };
  });
}
