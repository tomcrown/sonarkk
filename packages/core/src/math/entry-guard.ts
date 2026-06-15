/**
 * Entry guard: decide whether to skip an expiry.
 *
 * Per CLAUDE.md binding implementation (from Rule 4 / SVI oracle health section):
 *
 * Per-strategy ATM vol minimums:
 *   plp_supplier:        0.15  (house; earns spread at any vol)
 *   hedged_plp:          0.18  (hedge delta unreliable below ~18%)
 *   smart_vault:         0.18  (includes hedge leg, same floor)
 *   principal_protected: 0.15  (yield-based, vol-independent)
 *   range_roll:          0.28  (short-vol bettor; low implied = unfavorable)
 *   vol_targeted_range:  0.28  (same; vol-targeting doesn't fix bad entry)
 *   vol_arb_sell:        0.22  (needs meaningful spread to capture)
 *
 * Secondary: spread sanity check.
 *   If spread at ATM ≤ FLOOR_SPREAD + 0.001, the oracle may be miscalibrated
 *   (near-zero variance → degenerate spread). Skip regardless of vol.
 *
 * These thresholds protect against oracle miscalibration, not market risk.
 * A blanket 30% floor was explicitly rejected (legitimate oracles exist at 13–22%).
 */

import { atmVol, binaryCallProb } from './delta.js';
import type { SviParams } from './delta.js';

// ── Thresholds ─────────────────────────────────────────────────────────────

/**
 * Hard technical floor — no user or override can go below this.
 *
 * Below 10% ATM vol, SVI calibration becomes mathematically unreliable:
 * binary probabilities collapse toward 0.5 with no meaningful variance signal,
 * and the spread sanity check may still pass while prices are untrustworthy.
 * The confirmed working oracle range observed in Phase 4 was 13–46%; 10% is
 * the absolute lower bound for technically executable (not necessarily wise) trades.
 */
export const HARD_VOL_FLOOR = 0.10;

// Production thresholds (CLAUDE.md binding implementation Rule 4).
// Override via MIN_ATM_VOL_OVERRIDE_JSON env variable for testnet testing.
// Example: MIN_ATM_VOL_OVERRIDE_JSON='{"range_roll":0.13,"vol_targeted_range":0.13,"vol_arb_sell":0.10}'
// Only bettor strategies need testnet overrides — house strategies work at any vol.
const PRODUCTION_MIN_ATM_VOL: Record<StrategyId, number> = {
  plp_supplier:        0.15,
  hedged_plp:          0.18,
  smart_vault:         0.18,
  principal_protected: 0.15,
  range_roll:          0.28,
  vol_targeted_range:  0.28,
  vol_arb_sell:        0.22,
  margin_loop:         0.15,  // house-adjacent; earns at any vol above floor
};

function buildMinAtmVol(): Record<StrategyId, number> {
  const overrideJson = process.env['MIN_ATM_VOL_OVERRIDE_JSON'];
  if (!overrideJson) return { ...PRODUCTION_MIN_ATM_VOL };
  try {
    const overrides = JSON.parse(overrideJson) as Partial<Record<StrategyId, number>>;
    return { ...PRODUCTION_MIN_ATM_VOL, ...overrides };
  } catch {
    // Malformed JSON — fall back to production values. Do not silently lower thresholds.
    console.warn('[entry-guard] MIN_ATM_VOL_OVERRIDE_JSON is not valid JSON — using production thresholds');
    return { ...PRODUCTION_MIN_ATM_VOL };
  }
}

export const MIN_ATM_VOL: Record<StrategyId, number> = buildMinAtmVol();

const BASE_SPREAD = 0.02;
const FLOOR_SPREAD = 0.005;
const SPREAD_SANITY_MARGIN = 0.001;

export type StrategyId =
  | 'plp_supplier'
  | 'hedged_plp'
  | 'smart_vault'
  | 'principal_protected'
  | 'range_roll'
  | 'vol_targeted_range'
  | 'vol_arb_sell'
  | 'margin_loop';

// ── Spread computation ─────────────────────────────────────────────────────

/**
 * Spread at a given binary probability and pool utilization.
 * Mirrors the on-chain spread formula (CLAUDE.md §6).
 */
export function computeSpread(p: number, util: number): number {
  const util_mult = Math.min(2, 1 + util / 0.80);
  return Math.max(FLOOR_SPREAD, BASE_SPREAD * Math.sqrt(p * (1 - p)) * util_mult);
}

// ── Entry guard ────────────────────────────────────────────────────────────

export interface EntryGuardResult {
  skip: boolean;
  reason?: string;
  atm_vol: number;
  atm_spread: number;
  min_vol_threshold: number;       // effective threshold used (after floor clamp)
  system_default_threshold: number; // system default for this strategy (before override)
  hard_floor_applied: boolean;     // true if user override was below HARD_VOL_FLOOR
}

/**
 * Determine whether the keeper should skip this expiry for a given strategy.
 *
 * @param svi                Current oracle SVI params.
 * @param t_years            Time to expiry in years.
 * @param utilization        Current pool utilization fraction (0–1).
 * @param strategy           Which strategy is asking.
 * @param minAtmVolOverride  Per-portfolio override (from Portfolio.minAtmVolOverride).
 *                           Must be >= HARD_VOL_FLOOR (10%) — lower values are clamped.
 *                           undefined = use system default for this strategy.
 */
export function shouldSkipExpiry(
  svi: SviParams,
  t_years: number,
  utilization: number,
  strategy: StrategyId,
  minAtmVolOverride?: number | null,
): EntryGuardResult {
  const atm_vol_val = atmVol(svi, t_years);

  // Resolve effective threshold:
  // 1. Start with system default for this strategy.
  // 2. If user provided an override, apply it (they may raise OR lower the default).
  // 3. Hard floor: clamp to HARD_VOL_FLOOR regardless of any override.
  //    Below 10%, oracle calibration is unreliable — this is non-negotiable.
  const system_default = MIN_ATM_VOL[strategy];
  const user_threshold = minAtmVolOverride != null ? minAtmVolOverride : system_default;
  const threshold = Math.max(HARD_VOL_FLOOR, user_threshold);

  const hard_floor_applied = user_threshold < HARD_VOL_FLOOR;
  const shared = {
    system_default_threshold: system_default,
    hard_floor_applied,
    min_vol_threshold: threshold,
  };

  // ATM vol check.
  if (atm_vol_val < threshold) {
    return {
      skip: true,
      reason: `ATM vol ${(atm_vol_val * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% threshold for ${strategy}${hard_floor_applied ? ' (hard floor applied — user override was below 10%)' : ''}`,
      atm_vol: atm_vol_val,
      atm_spread: 0,
      ...shared,
    };
  }

  // Spread sanity check — secondary signal of oracle miscalibration.
  const p_atm = binaryCallProb(svi, 0); // k=0 → ATM probability ≈ 0.5
  const atm_spread = computeSpread(p_atm, utilization);
  if (atm_spread <= FLOOR_SPREAD + SPREAD_SANITY_MARGIN) {
    return {
      skip: true,
      reason: `ATM spread ${atm_spread.toFixed(4)} ≤ floor+margin (${(FLOOR_SPREAD + SPREAD_SANITY_MARGIN).toFixed(4)}) — likely oracle miscalibration`,
      atm_vol: atm_vol_val,
      atm_spread,
      ...shared,
    };
  }

  return { skip: false, atm_vol: atm_vol_val, atm_spread, ...shared };
}
