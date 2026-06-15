/**
 * Per-strategy position sizing for Sonark vaults.
 *
 * Each strategy has a sizing function that:
 *   1. Takes `available_balance` (not raw quote_balance — see nav.ts).
 *   2. Caps at `policy_budget_remaining` (PolicyCap ceiling — mandatory).
 *   3. Applies strategy-specific logic (utilization target, vol scaling, etc.).
 *
 * Inputs use DUSDC raw units (1e6 scale). Returns are also raw units.
 *
 * Quant assumptions (explicit per CLAUDE.md §4):
 *   - Target utilization for house strategies: 25% of available balance per cycle.
 *     This is a conservative default preventing over-concentration in one expiry.
 *   - Bettor strategies additionally scale by vol: size × min(1, target_vol/atm_vol).
 *   - Vol-Arb sell-mode size is capped at 10% of available to limit counterparty risk.
 *   - Principal-Protected: only yield, not principal, is used for Predict bets.
 *     Yield leg: accumulated_yield × BET_FRACTION (default 80%).
 *
 * Budget ceiling: if computed_size > policy_budget_remaining, use policy_budget_remaining
 * and set is_budget_capped = true. This is security-critical — must never be removed.
 */

// ── Constants ──────────────────────────────────────────────────────────────

/** Conservative default utilization per expiry for house strategies. */
export const DEFAULT_HOUSE_UTIL = 0.25;

/** Bettor strategies: target this realized vol (20% = calm-weather entry). */
export const BETTOR_TARGET_VOL = 0.20;

/** Vol-Arb: max fraction of available balance for one trade. */
export const VOL_ARB_MAX_FRACTION = 0.10;

/** Principal-Protected: fraction of accumulated yield to bet per cycle. */
export const PP_BET_FRACTION = 0.80;

// ── Result type ────────────────────────────────────────────────────────────

export interface SizingResult {
  /** Computed position size (DUSDC raw). */
  size_raw: bigint;
  /** True if capped by PolicyCap budget ceiling. */
  is_budget_capped: boolean;
  /** Ideal size before budget cap (same as size_raw if not capped). */
  ideal_size_raw: bigint;
  /** Utilization fraction that would result from this size. */
  utilization_fraction: number;
  /** Human-readable reason if size = 0 (skip this cycle). */
  skip_reason?: string;
}

// ── Shared cap logic ───────────────────────────────────────────────────────

function applyBudgetCap(ideal_raw: bigint, policy_budget_raw: bigint): SizingResult {
  const available_from_budget = policy_budget_raw < ideal_raw ? policy_budget_raw : ideal_raw;
  return {
    size_raw: available_from_budget,
    ideal_size_raw: ideal_raw,
    is_budget_capped: policy_budget_raw < ideal_raw,
    utilization_fraction: 0, // caller fills this in
  };
}

// ── Strategy sizing functions ──────────────────────────────────────────────

/**
 * Apply liquidity reserve before sizing.
 * The reserve is a fraction of available balance the keeper never deploys.
 * Returns reduced available balance after subtracting the reserve.
 */
function applyLiquidityReserve(available_raw: bigint, reserve_pct: number): bigint {
  if (reserve_pct <= 0) return available_raw;
  const reserve = BigInt(Math.floor(Number(available_raw) * Math.min(reserve_pct, 0.95)));
  return available_raw > reserve ? available_raw - reserve : 0n;
}

/**
 * ① PLP Supplier
 * Simple utilization of available balance.
 * @param available_balance_raw  Available DUSDC (quote_balance - locked - yield).
 * @param policy_budget_raw      Remaining PolicyCap budget.
 * @param util_target            Target utilization fraction (default 0.25). From Portfolio.utilTarget.
 * @param liquidity_reserve_pct  Fraction of balance never deployed (default 0). From Portfolio.liquidityReservePct.
 */
export function sizePlpSupplier(
  available_balance_raw: bigint,
  policy_budget_raw: bigint,
  util_target = DEFAULT_HOUSE_UTIL,
  liquidity_reserve_pct = 0,
): SizingResult {
  available_balance_raw = applyLiquidityReserve(available_balance_raw, liquidity_reserve_pct);
  if (available_balance_raw <= 0n) {
    return { size_raw: 0n, ideal_size_raw: 0n, is_budget_capped: false, utilization_fraction: 0, skip_reason: 'zero available balance' };
  }
  const ideal_raw = BigInt(Math.floor(Number(available_balance_raw) * util_target));
  const result = applyBudgetCap(ideal_raw, policy_budget_raw);
  result.utilization_fraction = Number(result.size_raw) / Number(available_balance_raw);
  return result;
}

/**
 * ② Hedged-PLP
 * Same sizing as ① but the hedge leg is sized separately (see hedge.ts).
 */
export function sizeHedgedPlp(
  available_balance_raw: bigint,
  policy_budget_raw: bigint,
  util_target = DEFAULT_HOUSE_UTIL,
  liquidity_reserve_pct = 0,
): SizingResult {
  return sizePlpSupplier(available_balance_raw, policy_budget_raw, util_target, liquidity_reserve_pct);
}

/**
 * ③ Smart Vault (Index)
 * Allocates across ①②. Weights: 60% Hedged-PLP, 40% PLP Supplier.
 *
 * 60/40 rationale: Hedged-PLP earns the same spread as PLP Supplier but adds a delta hedge
 * that materially reduces worst-5% drawdown at every vol regime (Phase 3 Rule 5 finding).
 * A 60% weight tilts toward the hedged position as primary without requiring full hedge budget —
 * at typical vault sizes the 40% PLP leg can run without any hedge, keeping friction manageable.
 * This default can be overridden per vault; a vault with sufficient hedge_budget should tilt
 * higher (toward 80/20) once Phase 4 keeper exposes the hedge_budget config.
 *
 * Returns a single "total supply size" — the keeper splits it into two TXs.
 */
export function sizeSmartVault(
  available_balance_raw: bigint,
  policy_budget_raw: bigint,
  hedged_plp_weight = 0.6,
  util_target = DEFAULT_HOUSE_UTIL,
  liquidity_reserve_pct = 0,
): { hedged_plp: SizingResult; plp_supplier: SizingResult } {
  available_balance_raw = applyLiquidityReserve(available_balance_raw, liquidity_reserve_pct);
  const total_ideal_raw = BigInt(Math.floor(Number(available_balance_raw) * util_target));
  const hedged_raw = BigInt(Math.floor(Number(total_ideal_raw) * hedged_plp_weight));
  const plp_raw = total_ideal_raw - hedged_raw;

  // Split budget proportionally.
  const budget_hedged = BigInt(Math.floor(Number(policy_budget_raw) * hedged_plp_weight));
  const budget_plp = policy_budget_raw - budget_hedged;

  const hedged_result = applyBudgetCap(hedged_raw, budget_hedged);
  hedged_result.utilization_fraction = Number(hedged_result.size_raw) / Number(available_balance_raw);

  const plp_result = applyBudgetCap(plp_raw, budget_plp);
  plp_result.utilization_fraction = Number(plp_result.size_raw) / Number(available_balance_raw);

  return { hedged_plp: hedged_result, plp_supplier: plp_result };
}

/**
 * ④ Principal-Protected
 * Only the yield leg participates in Predict bets. The principal is locked
 * (in mock lending on testnet, in IronBank on mainnet).
 *
 * @param yield_accumulated_raw  Accumulated yield available for betting.
 * @param policy_budget_raw      Remaining PolicyCap budget.
 * @param bet_fraction           Fraction of yield to bet this cycle (default 0.80).
 */
export function sizePrincipalProtected(
  yield_accumulated_raw: bigint,
  policy_budget_raw: bigint,
  bet_fraction = PP_BET_FRACTION,
): SizingResult {
  if (yield_accumulated_raw <= 0n) {
    return { size_raw: 0n, ideal_size_raw: 0n, is_budget_capped: false, utilization_fraction: 0, skip_reason: 'no yield accumulated yet' };
  }
  const ideal_raw = BigInt(Math.floor(Number(yield_accumulated_raw) * bet_fraction));
  const result = applyBudgetCap(ideal_raw, policy_budget_raw);
  result.utilization_fraction = Number(result.size_raw) / Number(yield_accumulated_raw);
  return result;
}

/**
 * ⑤ Range-Roll
 * Short-vol bettor. Size = util_target × available_balance.
 * Additional vol guard: skip this function call if implied ATM vol > 28%
 * (handled by entry-guard.ts, not here).
 */
export function sizeRangeRoll(
  available_balance_raw: bigint,
  policy_budget_raw: bigint,
  util_target = DEFAULT_HOUSE_UTIL,
  liquidity_reserve_pct = 0,
): SizingResult {
  return sizePlpSupplier(available_balance_raw, policy_budget_raw, util_target, liquidity_reserve_pct);
}

/**
 * ⑥ Vol-Targeted Range
 * Short-vol bettor with vol-targeting: scale down if implied vol is elevated.
 * size = util_target × available × min(1, target_vol / atm_vol)
 *
 * At target_vol = 20% and atm_vol = 40%, size = 50% of base.
 * At atm_vol = 20%, size = 100% of base.
 * At atm_vol = 10%, size = 100% (capped at 1 — never size UP into low-vol entries).
 *
 * @param atm_vol_annual  Current ATM implied vol (annualized, e.g. 0.35 = 35%).
 */
export function sizeVolTargetedRange(
  available_balance_raw: bigint,
  policy_budget_raw: bigint,
  atm_vol_annual: number,
  util_target = DEFAULT_HOUSE_UTIL,
  target_vol = BETTOR_TARGET_VOL,
  liquidity_reserve_pct = 0,
): SizingResult {
  available_balance_raw = applyLiquidityReserve(available_balance_raw, liquidity_reserve_pct);
  if (available_balance_raw <= 0n) {
    return { size_raw: 0n, ideal_size_raw: 0n, is_budget_capped: false, utilization_fraction: 0, skip_reason: 'zero available balance' };
  }
  // Vol scaling factor: never exceed 1 (don't size UP into low-vol entry).
  const vol_scale = atm_vol_annual > 0 ? Math.min(1, target_vol / atm_vol_annual) : 1;
  const ideal_raw = BigInt(Math.floor(Number(available_balance_raw) * util_target * vol_scale));
  const result = applyBudgetCap(ideal_raw, policy_budget_raw);
  result.utilization_fraction = Number(result.size_raw) / Number(available_balance_raw);
  return result;
}

/**
 * ⑦ Vol-Arb (sell-vol mode only)
 * Size is capped at VOL_ARB_MAX_FRACTION × available to limit concentration.
 * The arb signal (edge between Predict implied vol and Polymarket/Hyperliquid)
 * is used by the keeper to decide whether to enter — not here (entry-guard.ts).
 *
 * @param available_balance_raw  Available DUSDC.
 * @param policy_budget_raw      Remaining PolicyCap budget.
 * @param arb_confidence         0–1: how strong the arb signal is.
 *                               Full size at 1.0, proportional below.
 */
export function sizeVolArb(
  available_balance_raw: bigint,
  policy_budget_raw: bigint,
  arb_confidence: number,
  liquidity_reserve_pct = 0,
): SizingResult {
  available_balance_raw = applyLiquidityReserve(available_balance_raw, liquidity_reserve_pct);
  if (available_balance_raw <= 0n) {
    return { size_raw: 0n, ideal_size_raw: 0n, is_budget_capped: false, utilization_fraction: 0, skip_reason: 'zero available balance' };
  }
  const clamped_confidence = Math.max(0, Math.min(1, arb_confidence));
  const ideal_raw = BigInt(Math.floor(Number(available_balance_raw) * VOL_ARB_MAX_FRACTION * clamped_confidence));
  const result = applyBudgetCap(ideal_raw, policy_budget_raw);
  result.utilization_fraction = Number(result.size_raw) / Number(available_balance_raw);
  return result;
}
