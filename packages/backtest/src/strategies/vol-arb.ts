/**
 * Strategy ⑦ — Cross-Venue Vol-Arb (bettor + hedge on DeepBook Spot).
 *
 * Concept: trade on mispricing between Predict's SVI-implied vol and realized vol.
 * In production: compare Predict vs Polymarket/Hyperliquid binary prices.
 * In this backtest: compare Predict SVI-implied ATM vol vs trailing realized vol
 * (20-oracle window ≈ 5 hours). This measures whether the protocol systematically
 * over- or under-prices, which is the core arb signal.
 *
 * Production note: substitute Polymarket/Hyperliquid API prices for `realized_vol`
 * below to enable true cross-venue execution. The math is identical.
 *
 * Signal:
 *   implied_vol / realized_vol > (1 + ARITH_THRESHOLD) → SELL vol (house side for OTM options)
 *   implied_vol / realized_vol < (1 - ARITH_THRESHOLD) → BUY vol (mint ATM straddle)
 *   Otherwise → skip
 *
 * When SELLING vol: house side of ±0.5σ call + put pair (strangle).
 * When BUYING vol:  bettor side of ATM binary call + put (straddle).
 *
 * Hedge on Spot (per CLAUDE.md §2): delta-neutral position to isolate the vol bet.
 */
import { binaryCallProb, binaryCallDelta } from '../engine/svi.js';
import { computeSpread, houseBetPnl, bettorBetPnl } from '../engine/spread.js';
import { binaryCallWon, binaryPutWon } from '../engine/payoff.js';
import type { OracleRecord, RoundResult } from '../data/types.js';
import type { SimConfig } from './types.js';

const REALIZED_VOL_WINDOW = 20;  // oracle periods
const ARB_THRESHOLD = 0.15;      // 15% mispricing threshold before trading
const STRANGLE_SIGMA = 0.5;      // ±0.5σ for the sell-vol strangle
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
  const t_per = records[0]?.t_years ?? 1 / (365 * 96);
  return Math.sqrt(sumSqReturns / count / t_per);
}

export function simulateVolArb(
  records: OracleRecord[],
  config: SimConfig,
): RoundResult[] {
  return records.map((rec, idx) => {
    const realized_vol = computeRealizedVol(records, idx, REALIZED_VOL_WINDOW);
    if (realized_vol <= 0 || rec.atm_vol <= 0) {
      return { oracle_id: rec.oracle_id, expiry_ms: rec.expiry_ms, pnl_fraction: 0, spread_fraction: 0, won: null };
    }

    const vol_ratio = rec.atm_vol / realized_vol;
    const active_notional = config.vault_size_dusdc * config.utilization;
    const half_notional = active_notional / 2;
    const F = rec.forward_usd;
    const S_T = rec.settlement_price_usd;
    const S0 = F;
    const atm_vol_sqrt_t = rec.atm_vol * Math.sqrt(rec.t_years);

    let pnl = 0;
    let spread_total = 0;
    let net_delta_dbtc = 0;

    if (vol_ratio > 1 + ARB_THRESHOLD) {
      // ── Sell vol: house side of a strangle (±0.5σ call + put) ──────────
      const k_call = STRANGLE_SIGMA * atm_vol_sqrt_t;
      const k_put = -STRANGLE_SIGMA * atm_vol_sqrt_t;
      const K_call = F * Math.exp(k_call);
      const K_put = F * Math.exp(k_put);
      const p_call = binaryCallProb(rec.svi, k_call);
      const p_put = binaryPutProb(rec.svi, k_put);

      pnl += houseBetPnl(p_call, config.utilization, binaryCallWon(S_T, K_call), half_notional);
      pnl += houseBetPnl(p_put, config.utilization, binaryPutWon(S_T, K_put), half_notional);
      spread_total +=
        computeSpread(p_call, config.utilization) * half_notional +
        computeSpread(p_put, config.utilization) * half_notional;

      // Delta hedge: strangle is nearly delta-neutral at ±0.5σ but hedge residual.
      const d_call = binaryCallDelta(rec.svi, k_call) / S0;
      const d_put = -binaryCallDelta(rec.svi, k_put) / S0; // put has negative delta
      net_delta_dbtc = (d_call - d_put) * half_notional; // house is short both → short vol

    } else if (vol_ratio < 1 - ARB_THRESHOLD) {
      // ── Buy vol: bettor side of ATM straddle (call + put) ───────────────
      const p_atm_call = binaryCallProb(rec.svi, 0);
      const p_atm_put = 1 - p_atm_call;

      pnl += bettorBetPnl(p_atm_call, config.utilization, binaryCallWon(S_T, F), half_notional);
      pnl += bettorBetPnl(p_atm_put, config.utilization, binaryPutWon(S_T, F), half_notional);
      // spread cost is already embedded in bettorBetPnl via cost = p + spread
      spread_total +=
        computeSpread(p_atm_call, config.utilization) * half_notional +
        computeSpread(p_atm_put, config.utilization) * half_notional;

      // ATM straddle: delta ≈ 0 (calls + puts cancel), no hedge needed.
      net_delta_dbtc = 0;
    }
    // else: no trade this round

    // Apply DeepBook spot hedge.
    let hedge_pnl = 0;
    if (Math.abs(net_delta_dbtc) >= MIN_HEDGE_DBTC) {
      hedge_pnl = -net_delta_dbtc * (S_T - S0);
      const friction = (config.deepbook_friction_bps / 10_000) * Math.abs(net_delta_dbtc) * S0 * 2;
      hedge_pnl -= friction;
    }

    return {
      oracle_id: rec.oracle_id,
      expiry_ms: rec.expiry_ms,
      pnl_fraction: (pnl + hedge_pnl) / config.vault_size_dusdc,
      spread_fraction: spread_total / config.vault_size_dusdc,
      won: null,
    };
  });
}

function binaryPutProb(svi: import('../data/types.js').SviParams, k: number): number {
  return 1 - binaryCallProb(svi, k);
}
