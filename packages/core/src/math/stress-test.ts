/**
 * Rule 5 — High-vol stress test for Hedged-PLP.
 *
 * Tests the delta-hedge effectiveness across vol regimes: 27.7%, 40%, 60%, 80%.
 *
 * Method: analytical Monte Carlo using LogNormal settlement distribution.
 *   S_T ~ LogNormal(F, σ_realized, T)   (same as Phase 1 regime analysis)
 *   F = forward price (entry), T = expiry duration
 *
 * Per each sample S_T:
 *   1. Compute PLP house P&L (spread income + payout losses).
 *   2. Compute hedge P&L (from delta-hedge entered at activation).
 *   3. Compare: hedged P&L vs unhedged P&L.
 *
 * Hedge P&L sign:
 *   House net delta < 0 (short delta, more calls than puts) → hedge is LONG BTC.
 *   When BTC rises: house PLP loses (pays calls) + hedge gains (long BTC gains).
 *   → hedge offsets loss. ✓
 *
 * Output per vol regime:
 *   - Unhedged mean P&L, worst-5% drawdown, best-5% gain
 *   - Hedged mean P&L, worst-5% drawdown, best-5% gain
 *   - Hedge benefit = unhedged_p5 - hedged_p5  (positive = hedge reduced drawdown)
 *   - Hedge cost = mean friction cost
 *   - Net improvement = hedge_benefit - hedge_cost
 */

import { binaryCallProb, computeHouseNetDelta } from './delta.js';
import { computeHedgeOrder } from './hedge.js';
import type { SviParams, HouseStrikeExposure } from './delta.js';

// ── Simulation parameters ─────────────────────────────────────────────────

const N_SAMPLES = 50_000;
const VAULT_NOTIONAL = 100_000;   // DUSDC
const UTILIZATION = 0.25;         // fraction of vault deployed
const CALL_FRACTION = 0.55;       // 55/45 call/put flow (typical house imbalance)
const BASE_SPREAD = 0.02;
const FLOOR_SPREAD = 0.005;
const T_HOURS = 2;
const T_YEARS = T_HOURS / (365.25 * 24);
const FORWARD_PRICE = 75_000;     // USD — representative BTC price
const BUDGET_DUSDC = 5_000;       // keeper budget for the hedge leg
const DEEPBOOK_FRICTION_BPS = 8;  // round-trip bps

// Strike distribution (7 bands, normal-shaped)
const STRIKE_OFFSETS = [-2, -1.5, -1, 0, 1, 1.5, 2];
const STRIKE_WEIGHTS = [0.05, 0.10, 0.20, 0.30, 0.20, 0.10, 0.05];

// ── Helpers ───────────────────────────────────────────────────────────────

function computeSpread(p: number, util: number): number {
  const util_mult = Math.min(2, 1 + util / 0.80);
  return Math.max(FLOOR_SPREAD, BASE_SPREAD * Math.sqrt(p * (1 - p)) * util_mult);
}

/** Sample N lognormal settlement prices. */
function sampleLognormal(rng: () => number, forward: number, sigma: number, t: number, n: number): number[] {
  const results: number[] = [];
  // lognormal: S_T = F × exp((−σ²/2)×T + σ√T × Z)
  const drift = -0.5 * sigma * sigma * t;
  const vol_sqrt_t = sigma * Math.sqrt(t);
  for (let i = 0; i < n; i++) {
    // Box-Muller for standard normal
    const u1 = Math.max(rng(), 1e-15);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    results.push(forward * Math.exp(drift + vol_sqrt_t * z));
  }
  return results;
}

/** Simple seeded PRNG (xorshift32) for reproducible results. */
function makeRng(seed: number): () => number {
  let s = seed | 0 || 1;
  return function () {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4_294_967_296;
  };
}

// ── Build SVI params for a given ATM vol ─────────────────────────────────

/**
 * Build flat SVI smile for a given ATM vol and T.
 * Uses b=0 (flat smile) to guarantee w(k) = w_atm for all k.
 *
 * A non-flat smile (b > 0) requires b*sigma << w_atm to avoid the ATM total
 * variance being dominated by the b*sigma term rather than w_atm. For 2-hour
 * expiries w_atm ≈ 1.7e-5, so any b > 0.001 distorts the smile. We use a
 * flat smile here; per-expiry SVI calibration from the oracle is used in Phase 4.
 *
 * sigma=1 avoids division by zero in sqrt((k-m)^2 + sigma^2) while b=0 makes it irrelevant.
 */
function buildSvi(atm_vol: number, t_years: number): SviParams {
  const w = atm_vol * atm_vol * t_years;
  return { a: w, b: 0, rho: 0, m: 0, sigma: 1 };
}

// ── P&L computation for one settlement price ─────────────────────────────

interface RoundPnl {
  plp_pnl: number;
  hedge_pnl: number;
  total_pnl: number;
  spread_income: number;
}

function computeRoundPnl(
  s_t: number,
  svi: SviParams,
  hedge_direction: 'long' | 'short' | 'none',
  hedge_dbtc: number,
  hedge_notional: number,
  friction: number,
  atm_vol_sqrt_t: number,
  active_notional: number,
): RoundPnl {
  let plp_pnl = 0;
  let spread_income = 0;

  for (let i = 0; i < STRIKE_OFFSETS.length; i++) {
    const offset = STRIKE_OFFSETS[i]!;
    const weight = STRIKE_WEIGHTS[i]!;
    const k = offset * atm_vol_sqrt_t;
    const K = FORWARD_PRICE * Math.exp(k);
    const notional_at_strike = active_notional * weight;

    const call_notional = notional_at_strike * CALL_FRACTION;
    const put_notional = notional_at_strike * (1 - CALL_FRACTION);

    const p_call = binaryCallProb(svi, k);
    const p_put = 1 - p_call;

    const spread_call = computeSpread(p_call, UTILIZATION);
    const spread_put = computeSpread(p_put, UTILIZATION);
    const cost_call = p_call + spread_call;
    const cost_put = p_put + spread_put;

    // House P&L for calls
    const call_won = s_t > K;
    plp_pnl += call_won
      ? (cost_call - 1) * call_notional  // house paid out 1, received cost
      : cost_call * call_notional;         // house kept premium
    spread_income += spread_call * call_notional;

    // House P&L for puts
    const put_won = s_t < K;
    plp_pnl += put_won
      ? (cost_put - 1) * put_notional
      : cost_put * put_notional;
    spread_income += spread_put * put_notional;
  }

  // Hedge P&L
  let h_pnl = 0;
  if (hedge_direction !== 'none' && hedge_dbtc > 0) {
    const raw = hedge_direction === 'long'
      ? hedge_dbtc * (s_t - FORWARD_PRICE)
      : -hedge_dbtc * (s_t - FORWARD_PRICE);
    h_pnl = raw - friction;
  }

  return {
    plp_pnl,
    hedge_pnl: h_pnl,
    total_pnl: plp_pnl + h_pnl,
    spread_income,
  };
}

// ── Stress test runner ────────────────────────────────────────────────────

export interface VolRegimeResult {
  sigma_pct: number;
  n_samples: number;

  // Unhedged (PLP only)
  unhedged_mean_pnl: number;
  unhedged_p5_pnl: number;         // 5th percentile (worst 5%)
  unhedged_mean_return_bps: number; // bps of vault notional

  // Hedged (PLP + delta hedge)
  hedged_mean_pnl: number;
  hedged_p5_pnl: number;
  hedged_mean_return_bps: number;

  // Hedge stats
  hedge_direction: 'long' | 'short' | 'none';
  hedge_size_dbtc: number;
  hedge_notional_dusdc: number;
  hedge_is_partial: boolean;
  hedge_net_delta_dusdc_per_dollar: number;

  // Key metrics for Rule 5
  drawdown_reduction_dusdc: number;   // hedged_p5 - unhedged_p5 (+ = hedge improved floor)
  mean_friction_cost_dusdc: number;
  net_improvement_dusdc: number;      // drawdown_reduction - friction
  hedge_effective: boolean;           // true if net_improvement > 0
}

export function runRule5StressTest(): VolRegimeResult[] {
  const SIGMA_REGIMES = [0.277, 0.40, 0.60, 0.80];
  const results: VolRegimeResult[] = [];

  for (const sigma of SIGMA_REGIMES) {
    const svi = buildSvi(sigma, T_YEARS);
    const atm_vol_sqrt_t = sigma * Math.sqrt(T_YEARS);
    const active_notional = VAULT_NOTIONAL * UTILIZATION;

    // Build the house book as HouseStrikeExposure[]
    const strikes: HouseStrikeExposure[] = STRIKE_OFFSETS.map((offset, i) => {
      const k = offset * atm_vol_sqrt_t;
      const notional_at_strike = active_notional * (STRIKE_WEIGHTS[i] ?? 0);
      return {
        k,
        call_notional: notional_at_strike * CALL_FRACTION,
        put_notional: notional_at_strike * (1 - CALL_FRACTION),
      };
    });

    const house_net_delta = computeHouseNetDelta(svi, FORWARD_PRICE, strikes);

    const order = computeHedgeOrder({
      house_net_delta,
      spot_price_usd: FORWARD_PRICE,
      t_years: T_YEARS,
      budget_remaining_dusdc: BUDGET_DUSDC,
      friction_bps: DEEPBOOK_FRICTION_BPS,
    });

    // Sample settlement prices
    const rng = makeRng(0xdeadbeef);
    const settlements = sampleLognormal(rng, FORWARD_PRICE, sigma, T_YEARS, N_SAMPLES);

    const unhedged_pnls: number[] = [];
    const hedged_pnls: number[] = [];
    let total_friction = 0;

    for (const s_t of settlements) {
      const round = computeRoundPnl(
        s_t, svi,
        order.direction, order.size_dbtc, order.notional_dusdc, order.friction_cost_dusdc,
        atm_vol_sqrt_t, active_notional,
      );
      unhedged_pnls.push(round.plp_pnl);
      hedged_pnls.push(round.total_pnl);
      total_friction += order.friction_cost_dusdc;
    }

    unhedged_pnls.sort((a, b) => a - b);
    hedged_pnls.sort((a, b) => a - b);

    const p5_idx = Math.floor(N_SAMPLES * 0.05);
    const unhedged_p5 = unhedged_pnls[p5_idx]!;
    const hedged_p5 = hedged_pnls[p5_idx]!;
    const unhedged_mean = unhedged_pnls.reduce((s, v) => s + v, 0) / N_SAMPLES;
    const hedged_mean = hedged_pnls.reduce((s, v) => s + v, 0) / N_SAMPLES;

    // drawdown_reduction = improvement in worst-5% P&L from adding the hedge.
    // Positive = hedge raised the floor (hedged worst-case is less bad).
    // Negative = hedge lowered the floor (perverse hedge, finding to surface).
    const drawdown_reduction = hedged_p5 - unhedged_p5;
    const mean_friction = total_friction / N_SAMPLES;
    const net_improvement = drawdown_reduction - mean_friction;

    results.push({
      sigma_pct: sigma * 100,
      n_samples: N_SAMPLES,
      unhedged_mean_pnl: unhedged_mean,
      unhedged_p5_pnl: unhedged_p5,
      unhedged_mean_return_bps: (unhedged_mean / VAULT_NOTIONAL) * 10_000,
      hedged_mean_pnl: hedged_mean,
      hedged_p5_pnl: hedged_p5,
      hedged_mean_return_bps: (hedged_mean / VAULT_NOTIONAL) * 10_000,
      hedge_direction: order.direction,
      hedge_size_dbtc: order.size_dbtc,
      hedge_notional_dusdc: order.notional_dusdc,
      hedge_is_partial: order.is_partial,
      hedge_net_delta_dusdc_per_dollar: house_net_delta,
      drawdown_reduction_dusdc: drawdown_reduction,
      mean_friction_cost_dusdc: mean_friction,
      net_improvement_dusdc: net_improvement,
      hedge_effective: net_improvement > 0,
    });
  }

  return results;
}

/** Format the Rule 5 results as a markdown table for the phase report. */
export function formatRule5Table(results: VolRegimeResult[]): string {
  const header = `| σ | Unhedged P5 (DUSDC) | Hedged P5 (DUSDC) | Drawdown Reduction | Friction Cost | Net Improvement | Effective? |`;
  const sep    = `|---|---|---|---|---|---|---|`;
  const rows = results.map((r) => {
    const eff = r.hedge_effective ? '✓' : '✗ FINDING';
    return `| ${r.sigma_pct.toFixed(1)}% | ${r.unhedged_p5_pnl.toFixed(2)} | ${r.hedged_p5_pnl.toFixed(2)} | ${r.drawdown_reduction_dusdc.toFixed(2)} | ${r.mean_friction_cost_dusdc.toFixed(4)} | ${r.net_improvement_dusdc.toFixed(2)} | ${eff} |`;
  });
  return [header, sep, ...rows].join('\n');
}
