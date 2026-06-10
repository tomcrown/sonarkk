/**
 * Strategy ① — PLP Supplier (house).
 *
 * Deposits DUSDC into the PLP vault and earns spread income as the
 * counterparty to all binary bets. No directional exposure management.
 *
 * Model:
 *  - Active exposure = vault_size × utilization
 *  - Distributed across 7 synthetic strikes (±2σ around ATM), normal-weighted
 *  - 55% binary calls / 45% binary puts at each strike
 *  - House P&L = spread_collected - payouts_to_winners
 */
import { binaryCallProb } from '../engine/svi.js';
import { computeSpread, houseBetPnl } from '../engine/spread.js';
import { binaryCallWon, binaryPutWon } from '../engine/payoff.js';
import type { OracleRecord, RoundResult } from '../data/types.js';
import type { SimConfig } from './types.js';
import { STRIKE_WEIGHTS, STRIKE_SIGMA_OFFSETS } from './types.js';

export function simulatePlpSupplier(
  records: OracleRecord[],
  config: SimConfig,
): RoundResult[] {
  return records.map((rec) => {
    const active_notional = config.vault_size_dusdc * config.utilization;
    const atm_vol_sqrt_t = rec.atm_vol * Math.sqrt(rec.t_years);
    const F = rec.forward_usd;
    const S_T = rec.settlement_price_usd;

    let total_pnl = 0;
    let total_spread = 0;

    for (let i = 0; i < STRIKE_SIGMA_OFFSETS.length; i++) {
      const weight = STRIKE_WEIGHTS[i] ?? 0;
      const k = (STRIKE_SIGMA_OFFSETS[i] ?? 0) * atm_vol_sqrt_t; // log-moneyness offset
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
    }

    return {
      oracle_id: rec.oracle_id,
      expiry_ms: rec.expiry_ms,
      pnl_fraction: total_pnl / config.vault_size_dusdc,
      spread_fraction: total_spread / config.vault_size_dusdc,
      won: null,
    };
  });
}
