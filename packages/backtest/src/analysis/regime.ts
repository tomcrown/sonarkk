/**
 * Regime Adjustment Analysis — Betting Strategies ⑤ ⑥ ⑦
 *
 * The backtest ran against a 15.3-day window where BTC realised 27.7% annual vol
 * while SVI implied ~35-43%.  All short-vol bets looked great.
 *
 * This module asks: what happens if BTC realises 40 / 60 / 80% instead?
 *
 * Method — fully analytical (no Monte Carlo needed):
 *   Pricing stays fixed at the real SVI params from each oracle.
 *   Only the *settlement distribution* changes.
 *   If S_T ~ LogNormal(F, σ_real, T):
 *     P_real(S_T > K) = Φ(-k/(σ_real√T) - σ_real√T/2)   k = ln(K/F)
 *
 * From spread.ts (verified):
 *   E[house P&L] = notional × (spread + p_implied - p_realized)
 *   E[bettor P&L] = notional × (p_realized - cost) / cost   where cost = p_implied + spread
 *
 * These are exact expectations given the assumed lognormal realised distribution.
 */

import { Phi, binaryCallProb } from '../engine/svi.js';
import { computeSpread } from '../engine/spread.js';
import type { OracleRecord } from '../data/types.js';

// ─── Constants (match strategy files exactly) ──────────────────────────────

const VAULT_SIZE = 100_000;
const CALL_FRACTION = 0.55;
const RANGE_SIGMA = 1.0;           // ±1 implied-vol σ for range strategies
const VOL_TARGET_PCT = 0.005;      // 0.5% per-round vol target (strategy ⑥)
const VOL_ARB_K_SIGMA = 0.5;       // strangle strike at ±0.5σ  (strategy ⑦)
const ARB_THRESHOLD = 0.15;        // fire when |implied/realized − 1| > 15%
const DEEPBOOK_FRICTION_BPS = 8;   // 8 bps round-trip hedge friction

export const STRIKE_WEIGHTS = [0.05, 0.10, 0.20, 0.30, 0.20, 0.10, 0.05];
export const STRIKE_OFFSETS = [-2, -1.5, -1, 0, 1, 1.5, 2];

export const VOL_SCENARIOS: Array<{ label: string; sigma: number }> = [
  { label: '27.7% (observed)', sigma: 0.277 },
  { label: '40%  (mild)      ', sigma: 0.40 },
  { label: '60%  (normal BTC)', sigma: 0.60 },
  { label: '80%  (high vol)  ', sigma: 0.80 },
];

export const UTIL_LEVELS = [0.05, 0.25, 0.60];

// ─── Core analytical primitive ─────────────────────────────────────────────

/**
 * Binary call probability under a *realised* lognormal distribution
 * with annual vol σ_real.  Same formula as Black-Scholes d₂ but using
 * the realised vol, not the SVI-implied vol.
 */
function realizedCallProb(k: number, sigmaReal: number, tYears: number): number {
  if (sigmaReal <= 0 || tYears <= 0) return k <= 0 ? 1 : 0;
  const sqrtT = Math.sqrt(tYears);
  const d2 = -k / (sigmaReal * sqrtT) - sigmaReal * sqrtT / 2;
  return Phi(d2);
}

// ─── Per-oracle expected P&L helpers ──────────────────────────────────────

/**
 * E[house P&L / vault_size] for one binary position.
 * Derived from houseBetPnl in spread.ts:
 *   E = notional × (spread + p_implied − p_realized)
 */
function houseExpected(
  pImplied: number,
  pRealized: number,
  util: number,
  notionalFrac: number,   // notional / vault_size
): number {
  const spread = computeSpread(pImplied, util);
  return notionalFrac * (spread + pImplied - pRealized);
}

/**
 * E[bettor P&L / vault_size] for one binary position.
 * Derived from bettorBetPnl in spread.ts:
 *   E = notional × (p_realized − cost) / cost   where cost = p_implied + spread
 */
function bettorExpected(
  pImplied: number,
  pRealized: number,
  util: number,
  notionalFrac: number,
): number {
  const spread = computeSpread(pImplied, util);
  const cost = Math.max(1e-9, Math.min(1 - 1e-9, pImplied + spread));
  return notionalFrac * (pRealized - cost) / cost;
}

// ─── Per-round expected P&L under a given σ_real ──────────────────────────

/** ① PLP Supplier — house across 7 strikes, 55/45 call/put split. */
function plpRound(rec: OracleRecord, util: number, sigmaReal: number): number {
  const activeNotional = VAULT_SIZE * util;
  let pnl = 0;
  const sqrtT = Math.sqrt(rec.t_years);

  for (let i = 0; i < STRIKE_OFFSETS.length; i++) {
    const w = STRIKE_WEIGHTS[i] ?? 0;
    const k = (STRIKE_OFFSETS[i] ?? 0) * rec.atm_vol * sqrtT;

    const pCallImp = binaryCallProb(rec.svi, k);
    const pCallReal = realizedCallProb(k, sigmaReal, rec.t_years);
    const pPutImp = 1 - pCallImp;
    const pPutReal = 1 - pCallReal;

    const callFrac = (activeNotional * w * CALL_FRACTION) / VAULT_SIZE;
    const putFrac = (activeNotional * w * (1 - CALL_FRACTION)) / VAULT_SIZE;

    pnl += houseExpected(pCallImp, pCallReal, util, callFrac);
    pnl += houseExpected(pPutImp, pPutReal, util, putFrac);
  }
  return pnl;
}

/** ⑤ Range-Roll — bettor on ±1σ_implied range. */
function rangeRollRound(rec: OracleRecord, util: number, sigmaReal: number): number {
  const notionalFrac = util; // active_notional / vault_size = util (all-in)
  const sqrtT = Math.sqrt(rec.t_years);
  const kLow = -RANGE_SIGMA * rec.atm_vol * sqrtT;
  const kHigh = RANGE_SIGMA * rec.atm_vol * sqrtT;

  const pImp = Math.max(0, binaryCallProb(rec.svi, kLow) - binaryCallProb(rec.svi, kHigh));
  const pReal = Math.max(0, realizedCallProb(kLow, sigmaReal, rec.t_years) - realizedCallProb(kHigh, sigmaReal, rec.t_years));

  return bettorExpected(pImp, pReal, util, notionalFrac);
}

/**
 * ⑥ Vol-Targeted Range — same range but position sized to a vol target.
 * At higher realised vol, the range breaks more often AND SVI prices
 * a wider range; the vol-targeting may increase or decrease notional.
 */
function volTargetedRound(rec: OracleRecord, util: number, sigmaReal: number): number {
  const maxNotional = VAULT_SIZE * util;
  const sqrtT = Math.sqrt(rec.t_years);
  const kLow = -RANGE_SIGMA * rec.atm_vol * sqrtT;
  const kHigh = RANGE_SIGMA * rec.atm_vol * sqrtT;

  const pImp = Math.max(0, binaryCallProb(rec.svi, kLow) - binaryCallProb(rec.svi, kHigh));
  const spread = computeSpread(pImp, util);
  const cost = Math.max(1e-9, Math.min(1 - 1e-9, pImp + spread));

  // Std dev of binary outcome under implied distribution.
  const perUnitStd = Math.sqrt(Math.max(0, pImp * (1 - pImp)));
  // Solve: active_units × perUnitStd = VOL_TARGET_PCT × vault_size
  const targetUnits = perUnitStd > 1e-6
    ? (VOL_TARGET_PCT * VAULT_SIZE) / perUnitStd
    : maxNotional / cost;
  const activeNotional = Math.min(targetUnits * cost, maxNotional);
  const notionalFrac = activeNotional / VAULT_SIZE;

  const pReal = Math.max(0, realizedCallProb(kLow, sigmaReal, rec.t_years) - realizedCallProb(kHigh, sigmaReal, rec.t_years));
  return bettorExpected(pImp, pReal, util, notionalFrac);
}

/**
 * ⑦ Vol-Arb — signal is implied/realised ratio.
 *
 * Sell-vol mode (implied > realised × 1.15): house on ATM ±0.5σ strangle.
 * Buy-vol mode  (implied < realised × 0.85): bettor on ATM binary (direction-neutral avg).
 *
 * NOTE: buy-vol mode in production uses cross-venue probability reference
 * (Polymarket/Hyperliquid) for genuine positive EV.  In standalone mode
 * the ATM bettor EV is merely −spread per round (reported honestly here).
 */
function volArbRound(
  rec: OracleRecord,
  util: number,
  sigmaReal: number,
): { pnl: number; mode: 'sell' | 'buy' | 'none' } {
  const notionalFrac = util;
  const sqrtT = Math.sqrt(rec.t_years);
  const ratio = rec.atm_vol / sigmaReal;

  if (ratio > 1 + ARB_THRESHOLD) {
    // Sell vol: house on strangle ±0.5σ_implied
    const kCall = VOL_ARB_K_SIGMA * rec.atm_vol * sqrtT;
    const kPut = -VOL_ARB_K_SIGMA * rec.atm_vol * sqrtT;

    const pCallImp = binaryCallProb(rec.svi, kCall);
    const pCallReal = realizedCallProb(kCall, sigmaReal, rec.t_years);
    const pPutImp = 1 - binaryCallProb(rec.svi, kPut);
    const pPutReal = 1 - realizedCallProb(kPut, sigmaReal, rec.t_years);

    const callFrac = notionalFrac * CALL_FRACTION;
    const putFrac = notionalFrac * (1 - CALL_FRACTION);

    const pnl =
      houseExpected(pCallImp, pCallReal, util, callFrac) +
      houseExpected(pPutImp, pPutReal, util, putFrac) -
      (DEEPBOOK_FRICTION_BPS / 10_000) * notionalFrac; // hedge friction
    return { pnl, mode: 'sell' };

  } else if (ratio < 1 - ARB_THRESHOLD) {
    // Buy vol: bettor on ATM binary (equal weight call + put, direction-neutral).
    // Without cross-venue reference this is EV ≈ −spread.
    const pCallImp = binaryCallProb(rec.svi, 0);
    const pPutImp = 1 - pCallImp;
    const pCallReal = realizedCallProb(0, sigmaReal, rec.t_years);
    const pPutReal = 1 - pCallReal;

    const halfFrac = notionalFrac / 2;
    const pnl =
      bettorExpected(pCallImp, pCallReal, util, halfFrac) +
      bettorExpected(pPutImp, pPutReal, util, halfFrac);
    return { pnl, mode: 'buy' };

  } else {
    return { pnl: 0, mode: 'none' };
  }
}

// ─── Per-oracle win-rate under realised vol ────────────────────────────────

/** Avg realised win probability for Range-Roll (bettor wins = in range). */
function rangeWinRate(rec: OracleRecord, sigmaReal: number): number {
  const sqrtT = Math.sqrt(rec.t_years);
  const kLow = -RANGE_SIGMA * rec.atm_vol * sqrtT;
  const kHigh = RANGE_SIGMA * rec.atm_vol * sqrtT;
  return Math.max(0, realizedCallProb(kLow, sigmaReal, rec.t_years) - realizedCallProb(kHigh, sigmaReal, rec.t_years));
}

/** Avg realised win probability for PLP house (house wins = bettor loses). */
function plpHouseWinRate(rec: OracleRecord, util: number, sigmaReal: number): number {
  const sqrtT = Math.sqrt(rec.t_years);
  let weighted = 0;
  for (let i = 0; i < STRIKE_OFFSETS.length; i++) {
    const w = STRIKE_WEIGHTS[i] ?? 0;
    const k = (STRIKE_OFFSETS[i] ?? 0) * rec.atm_vol * sqrtT;
    const pCallReal = realizedCallProb(k, sigmaReal, rec.t_years);
    // House wins on call when bettor loses (BTC ≤ strike), on put when BTC ≥ strike.
    weighted += w * ((1 - pCallReal) * CALL_FRACTION + pCallReal * (1 - CALL_FRACTION));
  }
  return weighted;
}

// ─── Metric aggregation ────────────────────────────────────────────────────

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

export interface RegimeRow {
  strategy: string;
  sigma: number;
  vol_label: string;
  util: number;
  net_apy: number;       // annualised total return
  mean_win_rate: number; // avg per-oracle probability of winning
  mode?: string;         // for vol-arb
  note?: string;
}

function apy(rounds: number[], records: OracleRecord[]): number {
  const total = rounds.reduce((s, v) => s + v, 0);
  const firstMs = records[0]?.expiry_ms ?? 0;
  const lastMs = records[records.length - 1]?.expiry_ms ?? 0;
  const tYears = (lastMs - firstMs) / MS_PER_YEAR;
  return tYears > 0 ? total / tYears : total;
}

// ─── Break-even computation (binary search per oracle, then average) ───────

/**
 * Finds the realised vol at which Range-Roll bettor breaks even (E[APY] = 0).
 * Per oracle, solve: p_range_real(σ) = cost_implied.
 * Returns mean break-even σ across all oracles.
 */
export function breakEvenVol(records: OracleRecord[], util: number): number {
  const bes = records.map((rec) => {
    const sqrtT = Math.sqrt(rec.t_years);
    const kLow = -RANGE_SIGMA * rec.atm_vol * sqrtT;
    const kHigh = RANGE_SIGMA * rec.atm_vol * sqrtT;

    const pImp = Math.max(0, binaryCallProb(rec.svi, kLow) - binaryCallProb(rec.svi, kHigh));
    const cost = Math.min(1 - 1e-9, pImp + computeSpread(pImp, util));

    // p_range(σ) is monotone decreasing in σ → binary search
    let lo = 1e-4, hi = 10.0;
    for (let n = 0; n < 64; n++) {
      const mid = (lo + hi) / 2;
      const p = Math.max(0,
        realizedCallProb(kLow, mid, rec.t_years) - realizedCallProb(kHigh, mid, rec.t_years));
      if (p > cost) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  });
  return bes.reduce((s, v) => s + v, 0) / bes.length;
}

// ─── Main analysis runner ──────────────────────────────────────────────────

export function runRegimeAnalysis(records: OracleRecord[]): RegimeRow[] {
  const rows: RegimeRow[] = [];

  for (const util of UTIL_LEVELS) {
    for (const scenario of VOL_SCENARIOS) {
      const { label, sigma } = scenario;

      // ① PLP
      const plpPnls = records.map((r) => plpRound(r, util, sigma));
      const plpWR = records.reduce((s, r) => s + plpHouseWinRate(r, util, sigma), 0) / records.length;
      rows.push({ strategy: '① PLP Supplier', sigma, vol_label: label, util, net_apy: apy(plpPnls, records), mean_win_rate: plpWR });

      // ⑤ Range-Roll
      const rrPnls = records.map((r) => rangeRollRound(r, util, sigma));
      const rrWR = records.reduce((s, r) => s + rangeWinRate(r, sigma), 0) / records.length;
      rows.push({ strategy: '⑤ Range-Roll', sigma, vol_label: label, util, net_apy: apy(rrPnls, records), mean_win_rate: rrWR });

      // ⑥ Vol-Targeted Range
      const vtPnls = records.map((r) => volTargetedRound(r, util, sigma));
      rows.push({ strategy: '⑥ Vol-Targeted', sigma, vol_label: label, util, net_apy: apy(vtPnls, records), mean_win_rate: rrWR }); // same win rate as ⑤ (same range)

      // ⑦ Vol-Arb
      const vaResults = records.map((r) => volArbRound(r, util, sigma));
      const vaPnls = vaResults.map((r) => r.pnl);
      const modes = vaResults.map((r) => r.mode);
      const sellCount = modes.filter((m) => m === 'sell').length;
      const buyCount = modes.filter((m) => m === 'buy').length;
      const noneCount = modes.filter((m) => m === 'none').length;
      const dominantMode = sellCount >= buyCount && sellCount >= noneCount ? 'sell vol'
        : buyCount >= noneCount ? 'buy vol' : 'no trade';
      const modeNote = `${sellCount} sell / ${buyCount} buy / ${noneCount} idle`;

      // Win rate for vol-arb: sell mode = bettor loses (house wins), buy mode = bettor wins
      const vaWR = vaResults.reduce((s, r, i) => {
        const rec = records[i];
        if (!rec) return s;
        if (r.mode === 'sell') {
          // House on strangle: wins when both call and put bettor lose
          const sqrtT = Math.sqrt(rec.t_years);
          const kCall = VOL_ARB_K_SIGMA * rec.atm_vol * sqrtT;
          return s + (1 - realizedCallProb(kCall, sigma, rec.t_years));
        } else if (r.mode === 'buy') {
          return s + realizedCallProb(0, sigma, rec.t_years); // ATM call win rate
        }
        return s;
      }, 0) / records.length;

      rows.push({
        strategy: '⑦ Vol-Arb',
        sigma, vol_label: label, util,
        net_apy: apy(vaPnls, records),
        mean_win_rate: vaWR,
        mode: dominantMode,
        note: modeNote,
      });
    }
  }

  return rows;
}
