/**
 * Strategy ② — Hedged-PLP (house + delta-hedge on DeepBook Spot).
 *
 * Same as PLP Supplier but adds a dynamic delta-hedge each round to offset
 * the PLP's net directional BTC exposure (net-long call liability).
 *
 * Quant assumptions (documented per CLAUDE.md §4):
 *  1. Hedge is placed at oracle activation and unwound at settlement.
 *     Mid-period delta drift is ignored (valid for 2-hour horizons; error < 1%).
 *  2. Hedge delta = Σ_i (call_frac - put_frac) × notional_i × φ(d₂_i) / (S₀ × √w_i)
 *     = (2×call_fraction - 1) × Σ_i notional_i × binaryCallDelta(k_i) / S₀
 *     Units: DBTC.
 *  3. DeepBook round-trip friction = deepbook_friction_bps (default 8bps) × hedge_notional_usd.
 *  4. Hedge is only placed if net_delta > 0.001 DBTC (below this it's not worth the friction).
 *
 * The hedge is done on the SPOT market (not by buying OTM binaries — per CLAUDE.md §2).
 */
import { binaryCallProb, binaryCallDelta } from '../engine/svi.js';
import { computeSpread, houseBetPnl } from '../engine/spread.js';
import { binaryCallWon, binaryPutWon } from '../engine/payoff.js';
import type { OracleRecord, RoundResult } from '../data/types.js';
import type { SimConfig } from './types.js';
import { STRIKE_WEIGHTS, STRIKE_SIGMA_OFFSETS } from './types.js';

// Minimum hedge size to justify DeepBook friction cost.
const MIN_HEDGE_DBTC = 0.001;

export function simulateHedgedPlp(
  records: OracleRecord[],
  config: SimConfig,
): RoundResult[] {
  return records.map((rec) => {
    const active_notional = config.vault_size_dusdc * config.utilization;
    const atm_vol_sqrt_t = rec.atm_vol * Math.sqrt(rec.t_years);
    const F = rec.forward_usd;
    const S_T = rec.settlement_price_usd;
    const S0 = F; // entry = activation forward price

    let total_pnl = 0;
    let total_spread = 0;
    let net_delta_dbtc = 0; // DBTC to short

    for (let i = 0; i < STRIKE_SIGMA_OFFSETS.length; i++) {
      const weight = STRIKE_WEIGHTS[i] ?? 0;
      const k = (STRIKE_SIGMA_OFFSETS[i] ?? 0) * atm_vol_sqrt_t;
      const strike_usd = F * Math.exp(k);
      const notional_at_strike = active_notional * weight;
      const call_notional = notional_at_strike * config.call_fraction;
      const put_notional = notional_at_strike * (1 - config.call_fraction);

      const p_call = binaryCallProb(rec.svi, k);
      const p_put = 1 - p_call;

      const call_won = binaryCallWon(S_T, strike_usd);
      const put_won = binaryPutWon(S_T, strike_usd);

      const spread_call = computeSpread(p_call, config.utilization);
      const spread_put = computeSpread(p_put, config.utilization);

      total_pnl += houseBetPnl(p_call, config.utilization, call_won, call_notional);
      total_pnl += houseBetPnl(p_put, config.utilization, put_won, put_notional);
      total_spread += spread_call * call_notional + spread_put * put_notional;

      // Net delta contribution: (call_frac - put_frac) × notional × δcall / S0
      const delta_i = binaryCallDelta(rec.svi, k) / S0; // per DUSDC per $1 BTC
      net_delta_dbtc +=
        (config.call_fraction - (1 - config.call_fraction)) *
        notional_at_strike *
        delta_i;
    }

    // Apply delta-hedge if large enough to justify friction.
    let hedge_pnl = 0;
    if (Math.abs(net_delta_dbtc) >= MIN_HEDGE_DBTC) {
      // Short net_delta_dbtc DBTC at S0, unwind at S_T.
      // Hedge is a short → P&L = -net_delta × (S_T - S0)
      hedge_pnl = -net_delta_dbtc * (S_T - S0);
      // Friction = bps × round-trip notional (entry + exit ≈ 2 × entry)
      const friction_cost =
        (config.deepbook_friction_bps / 10_000) * net_delta_dbtc * S0 * 2;
      hedge_pnl -= Math.abs(friction_cost);
    }

    return {
      oracle_id: rec.oracle_id,
      expiry_ms: rec.expiry_ms,
      pnl_fraction: (total_pnl + hedge_pnl) / config.vault_size_dusdc,
      spread_fraction: total_spread / config.vault_size_dusdc,
      won: null,
    };
  });
}
