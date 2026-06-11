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

export const MIN_ATM_VOL: Record<StrategyId, number> = {
  plp_supplier:        0.15,
  hedged_plp:          0.18,
  smart_vault:         0.18,
  principal_protected: 0.15,
  range_roll:          0.28,
  vol_targeted_range:  0.28,
  vol_arb_sell:        0.22,
};

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
  | 'vol_arb_sell';

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
  min_vol_threshold: number;
}

/**
 * Determine whether the keeper should skip this expiry for a given strategy.
 *
 * @param svi          Current oracle SVI params.
 * @param t_years      Time to expiry in years.
 * @param utilization  Current pool utilization fraction (0–1).
 * @param strategy     Which strategy is asking.
 */
export function shouldSkipExpiry(
  svi: SviParams,
  t_years: number,
  utilization: number,
  strategy: StrategyId,
): EntryGuardResult {
  const atm_vol_val = atmVol(svi, t_years);
  const threshold = MIN_ATM_VOL[strategy];

  // ATM vol check.
  if (atm_vol_val < threshold) {
    return {
      skip: true,
      reason: `ATM vol ${(atm_vol_val * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% threshold for ${strategy}`,
      atm_vol: atm_vol_val,
      atm_spread: 0,
      min_vol_threshold: threshold,
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
      min_vol_threshold: threshold,
    };
  }

  return { skip: false, atm_vol: atm_vol_val, atm_spread, min_vol_threshold: threshold };
}
