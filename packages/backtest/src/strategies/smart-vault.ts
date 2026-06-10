/**
 * Strategy ③ — Smart Vault (Index).
 *
 * Auto-allocates across ①+② with the hedge, plus a small vol overlay.
 * Rebalanced each round.
 *
 * Allocation:
 *   - 60% of active notional → PLP Supplier (pure spread collection)
 *   - 30% of active notional → Hedged-PLP delta (spread + hedge offset)
 *   - 10% of active notional → Vol overlay:
 *       Buy ATM binary calls when implied_vol < trailing_realized_vol × 0.90
 *       Buy ATM binary puts  when implied_vol > trailing_realized_vol × 1.10
 *       Otherwise skip vol overlay (implied ≈ realized → no edge)
 *
 * The vol overlay fires in about 20-30% of rounds (based on typical vol cycles).
 * Trailing realized vol uses a 20-oracle window (5-hour window at 15-min intervals).
 */
import { binaryCallProb } from '../engine/svi.js';
import { computeSpread, houseBetPnl, bettorBetPnl } from '../engine/spread.js';
import { binaryCallWon, binaryPutWon } from '../engine/payoff.js';
import { binaryCallDelta } from '../engine/svi.js';
import type { OracleRecord, RoundResult } from '../data/types.js';
import type { SimConfig } from './types.js';
import { STRIKE_WEIGHTS, STRIKE_SIGMA_OFFSETS } from './types.js';

const ALLOC_PLP = 0.60;
const ALLOC_HEDGE = 0.30;
const ALLOC_VOL_OVERLAY = 0.10;
const VOL_OVERLAY_WINDOW = 20;
// Threshold: deploy overlay when |implied/realized - 1| > this
const VOL_OVERLAY_THRESHOLD = 0.10;
const MIN_HEDGE_DBTC = 0.001;

function computeRealizedVol(records: OracleRecord[], endIdx: number, window: number): number {
  const start = Math.max(0, endIdx - window);
  const slice = records.slice(start, endIdx + 1);
  if (slice.length < 2) return 0;
  let sumSqReturns = 0;
  let count = 0;
  for (let j = 1; j < slice.length; j++) {
    const cur = slice[j];
    const prev = slice[j - 1];
    if (!cur || !prev || prev.settlement_price_usd <= 0) continue;
    const logRet = Math.log(cur.settlement_price_usd / prev.settlement_price_usd);
    sumSqReturns += logRet * logRet;
    count++;
  }
  if (count === 0) return 0;
  // Annualise: divide variance by t_years per interval then sqrt
  const t_per_interval = slice[0]?.t_years ?? 1 / (365 * 96);
  return Math.sqrt(sumSqReturns / count / t_per_interval);
}

export function simulateSmartVault(
  records: OracleRecord[],
  config: SimConfig,
): RoundResult[] {
  return records.map((rec, idx) => {
    const active_notional = config.vault_size_dusdc * config.utilization;
    const atm_vol_sqrt_t = rec.atm_vol * Math.sqrt(rec.t_years);
    const F = rec.forward_usd;
    const S_T = rec.settlement_price_usd;
    const S0 = F;

    // ── PLP + Hedge portion (90% of active_notional) ──────────────────────
    let house_pnl = 0;
    let total_spread = 0;
    let net_delta_dbtc = 0;

    for (let i = 0; i < STRIKE_SIGMA_OFFSETS.length; i++) {
      const weight = STRIKE_WEIGHTS[i] ?? 0;
      const k = (STRIKE_SIGMA_OFFSETS[i] ?? 0) * atm_vol_sqrt_t;
      const strike_usd = F * Math.exp(k);

      // PLP allocation
      const plp_notional = active_notional * ALLOC_PLP * weight;
      const plp_call = plp_notional * config.call_fraction;
      const plp_put = plp_notional * (1 - config.call_fraction);
      const p_call = binaryCallProb(rec.svi, k);
      const p_put = 1 - p_call;

      house_pnl += houseBetPnl(p_call, config.utilization, binaryCallWon(S_T, strike_usd), plp_call);
      house_pnl += houseBetPnl(p_put, config.utilization, binaryPutWon(S_T, strike_usd), plp_put);
      total_spread +=
        computeSpread(p_call, config.utilization) * plp_call +
        computeSpread(p_put, config.utilization) * plp_put;

      // Hedge delta from hedged-PLP allocation
      const hedge_notional = active_notional * ALLOC_HEDGE * weight;
      const hedge_call = hedge_notional * config.call_fraction;
      const hedge_put = hedge_notional * (1 - config.call_fraction);

      house_pnl += houseBetPnl(p_call, config.utilization, binaryCallWon(S_T, strike_usd), hedge_call);
      house_pnl += houseBetPnl(p_put, config.utilization, binaryPutWon(S_T, strike_usd), hedge_put);
      total_spread +=
        computeSpread(p_call, config.utilization) * hedge_call +
        computeSpread(p_put, config.utilization) * hedge_put;

      const delta_i = binaryCallDelta(rec.svi, k) / S0;
      net_delta_dbtc +=
        (config.call_fraction - (1 - config.call_fraction)) *
        hedge_notional *
        delta_i;
    }

    // Apply hedge to hedge allocation.
    let hedge_pnl = 0;
    if (Math.abs(net_delta_dbtc) >= MIN_HEDGE_DBTC) {
      hedge_pnl = -net_delta_dbtc * (S_T - S0);
      const friction = (config.deepbook_friction_bps / 10_000) * Math.abs(net_delta_dbtc) * S0 * 2;
      hedge_pnl -= friction;
    }

    // ── Vol overlay (10% of active_notional) ───────────────────────────────
    let overlay_pnl = 0;
    const overlay_notional = active_notional * ALLOC_VOL_OVERLAY;
    const realized_vol = computeRealizedVol(records, idx, VOL_OVERLAY_WINDOW);

    if (realized_vol > 0 && rec.atm_vol > 0) {
      const ratio = rec.atm_vol / realized_vol;
      if (ratio > 1 + VOL_OVERLAY_THRESHOLD) {
        // Implied vol overestimates realized → sell vol → act as mini house on ATM options
        const p_atm_call = binaryCallProb(rec.svi, 0);
        const p_atm_put = 1 - p_atm_call;
        const ov_call = overlay_notional * config.call_fraction;
        const ov_put = overlay_notional * (1 - config.call_fraction);
        overlay_pnl += houseBetPnl(p_atm_call, config.utilization, binaryCallWon(S_T, F), ov_call);
        overlay_pnl += houseBetPnl(p_atm_put, config.utilization, binaryPutWon(S_T, F), ov_put);
        total_spread +=
          computeSpread(p_atm_call, config.utilization) * ov_call +
          computeSpread(p_atm_put, config.utilization) * ov_put;
      } else if (ratio < 1 - VOL_OVERLAY_THRESHOLD) {
        // Implied vol underestimates realized → buy vol → mint ATM binary (call if BTC trending up)
        const p_atm_call = binaryCallProb(rec.svi, 0);
        const btc_trending_up = idx > 0 && rec.forward_usd > (records[idx - 1]?.forward_usd ?? 0);
        const call_won = binaryCallWon(S_T, F);
        const put_won = binaryPutWon(S_T, F);
        if (btc_trending_up) {
          overlay_pnl += bettorBetPnl(p_atm_call, config.utilization, call_won, overlay_notional);
        } else {
          overlay_pnl += bettorBetPnl(1 - p_atm_call, config.utilization, put_won, overlay_notional);
        }
      }
      // else: implied ≈ realized → no overlay, overlay_pnl = 0
    }

    const total_pnl = house_pnl + hedge_pnl + overlay_pnl;
    return {
      oracle_id: rec.oracle_id,
      expiry_ms: rec.expiry_ms,
      pnl_fraction: total_pnl / config.vault_size_dusdc,
      spread_fraction: total_spread / config.vault_size_dusdc,
      won: null,
    };
  });
}
