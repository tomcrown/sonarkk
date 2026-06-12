/**
 * Hedge budget formula for Strategy ② Hedged-PLP.
 *
 * The keeper computes hedge_budget dynamically each cycle:
 *
 *   hedge_budget = min(
 *     active_notional × hedge_multiplier,   // scales with Predict exposure
 *     available_balance × 0.50              // safety cap: never > 50% of idle cash
 *   )
 *
 * Design trade-off (documented per Phase 4 requirements):
 *   The 50% cap creates a KNOWN TENSION at high utilization: when the vault has
 *   deployed most of its DUSDC into Predict (high active_notional, low idle cash),
 *   the safety cap constrains the hedge exactly when it's most needed — high
 *   exposure but insufficient budget to fully hedge it. This is an accepted
 *   design constraint, not a bug. The alternative (no cap) risks deploying all
 *   idle cash to DeepBook, leaving nothing for withdrawals.
 *   Solution path: allow owners to configure a dedicated hedge reserve account
 *   in Phase 5. For now, the 50% cap is the conservative safe default.
 *
 * All amounts in DUSDC raw units (1e6 scale = 1 DUSDC).
 */

export interface HedgeBudgetResult {
  hedge_budget_raw: bigint;
  is_cap_constrained: boolean;
  ideal_budget_raw: bigint;
  coverage_comment: string;
}

/**
 * Compute the hedge budget for this cycle.
 *
 * @param active_notional_raw  DUSDC currently deployed in Predict (LP position value).
 * @param hedge_multiplier     Per-vault config (default 1.0). Scale: >1 over-hedges; <1 under-hedges.
 * @param available_balance_raw  quote_balance − locked_principal − yield_accumulated.
 */
export function computeHedgeBudget(
  active_notional_raw: bigint,
  hedge_multiplier: number,
  available_balance_raw: bigint,
): HedgeBudgetResult {
  const ideal_from_notional = BigInt(
    Math.floor(Number(active_notional_raw) * hedge_multiplier),
  );
  const safety_cap = available_balance_raw / 2n; // 50% of idle cash

  const ideal_budget_raw = ideal_from_notional;
  const hedge_budget_raw = ideal_from_notional < safety_cap ? ideal_from_notional : safety_cap;
  const is_cap_constrained = hedge_budget_raw < ideal_budget_raw;

  const coverage_comment = is_cap_constrained
    ? `Safety cap active: budget capped at ${safety_cap} (50% idle cash) vs ideal ${ideal_budget_raw}. ` +
      `High-utilization tension — see hedge-budget.ts design trade-off comment.`
    : `Full hedge budget available: ${hedge_budget_raw} DUSDC.`;

  return { hedge_budget_raw, is_cap_constrained, ideal_budget_raw, coverage_comment };
}

/**
 * Compute coverage ratio for logging.
 *
 * coverage_ratio = actual_hedge_notional / ideal_hedge_notional × 100
 *
 * A ratio of 100% = fully hedged. <100% = partially hedged (budget constrained).
 * Logged every cycle; written to DB for Phase 5 display.
 */
export function computeCoverageRatio(
  ideal_hedge_notional_dusdc: number,
  actual_hedge_notional_dusdc: number,
): number {
  if (ideal_hedge_notional_dusdc <= 0) return 100;
  return Math.min(100, (actual_hedge_notional_dusdc / ideal_hedge_notional_dusdc) * 100);
}
