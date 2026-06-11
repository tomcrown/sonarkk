/**
 * Spot hedge sizing for Strategy ② Hedged-PLP.
 *
 * The PLP vault writes binary and range options. Its net delta is the sum of
 * all exposures (see delta.ts). To be delta-neutral, the vault needs an
 * offsetting Spot position on DeepBook.
 *
 * Hedge direction:
 *   - If house_net_delta < 0 (short delta — more calls than puts):
 *     house LOSES when BTC rises → hedge by going LONG DBTC.
 *   - If house_net_delta > 0 (long delta — more puts than calls):
 *     house LOSES when BTC falls → hedge by going SHORT DBTC.
 *
 * Size: |house_net_delta| / spot_price = DBTC units.
 *
 * Budget ceiling: the hedge order cost must fit within PolicyCap.budget_remaining.
 * If |hedge_notional_dusdc| > budget, cap and record the partial hedge shortfall.
 *
 * DeepBook friction: round-trip bid-ask spread is modelled as 8 bps of notional
 * (Phase 1 verified assumption). This is the cost of entering + exiting the hedge.
 *
 * Near-expiry scaling: delta magnitudes spike as T→0. Below MIN_T_YEARS_FOR_HEDGE
 * (5 minutes) we linearly scale the hedge size to zero to avoid issuing thrashing
 * Spot orders that would cost more in friction than they save.
 */

import { MIN_T_YEARS_FOR_HEDGE } from './delta.js';

/** Default round-trip friction (basis points). Phase 1 §4.4 verified assumption. */
export const DEFAULT_FRICTION_BPS = 8;

/** Below this notional, the friction cost exceeds the hedge value. */
export const MIN_HEDGE_NOTIONAL_DUSDC = 0.1; // 10 cents

export interface HedgeInput {
  /**
   * House net delta in DBTC (from computeHouseNetDelta).
   * Negative = house is net short delta (more calls written than puts).
   * Positive = house is net long delta (more puts written than calls).
   * Units: Δ_norm × notional/spot = [dimensionless × DUSDC/(DUSDC/DBTC)] = DBTC.
   */
  house_net_delta: number;
  /** Current BTC spot price in USD. */
  spot_price_usd: number;
  /** Time to expiry in years (for near-expiry scaling). */
  t_years: number;
  /** Maximum DUSDC the keeper can spend on the hedge (PolicyCap ceiling). */
  budget_remaining_dusdc: number;
  /** Round-trip friction in bps. Default: 8. */
  friction_bps?: number;
}

export interface HedgeOrder {
  /** Direction on DeepBook Spot. */
  direction: 'long' | 'short' | 'none';
  /** DBTC units to trade. 0 when direction = 'none'. */
  size_dbtc: number;
  /** DUSDC cost of the hedge (size × spot). */
  notional_dusdc: number;
  /** Expected friction cost = friction_bps / 10000 × notional × 2 (round-trip). */
  friction_cost_dusdc: number;
  /** True if the ideal hedge was capped by budget_remaining. */
  is_partial: boolean;
  /** Shortfall: ideal notional − actual notional (0 if not capped). */
  shortfall_dusdc: number;
  /** True if hedge was skipped (near expiry, below min notional, or zero delta). */
  skipped: boolean;
  /** Reason for skip, if skipped. */
  skip_reason?: string;
}

/**
 * Compute the Spot hedge order for the current cycle.
 *
 * Returns a HedgeOrder describing what to send to DeepBook.
 * Direction 'none' means: do not place an order this cycle.
 */
export function computeHedgeOrder(input: HedgeInput): HedgeOrder {
  const friction_bps = input.friction_bps ?? DEFAULT_FRICTION_BPS;

  const NO_HEDGE = (reason: string): HedgeOrder => ({
    direction: 'none',
    size_dbtc: 0,
    notional_dusdc: 0,
    friction_cost_dusdc: 0,
    is_partial: false,
    shortfall_dusdc: 0,
    skipped: true,
    skip_reason: reason,
  });

  if (input.house_net_delta === 0) return NO_HEDGE('zero net delta');

  // Near-expiry: scale down linearly from 1.0 at MIN_T_YEARS to 0.0 at 0.
  // Avoids placing large thrashing orders in the final minutes of an expiry.
  let expiry_scale = 1.0;
  if (input.t_years < MIN_T_YEARS_FOR_HEDGE) {
    expiry_scale = input.t_years / MIN_T_YEARS_FOR_HEDGE;
  }

  // ideal_dbtc = |house_net_delta| because house_net_delta IS already in DBTC.
  // Derivation: Δ_norm × notional/S where notional is DUSDC and S is DUSDC/DBTC → DBTC.
  // ideal_notional_dusdc = ideal_dbtc × spot_price.
  //
  // For a 25k DUSDC book at 27.7% vol / 2hr: Δ_norm ≈ 95, ideal_dbtc ≈ 1.97 DBTC (~$148k).
  // Near-expiry binary delta can be enormous — the budget cap is almost always triggered.
  const ideal_dbtc = Math.abs(input.house_net_delta) * expiry_scale;
  const ideal_notional_dusdc = ideal_dbtc * input.spot_price_usd;

  if (ideal_notional_dusdc < MIN_HEDGE_NOTIONAL_DUSDC) {
    return NO_HEDGE(`below minimum notional (${ideal_notional_dusdc.toFixed(4)} DUSDC)`);
  }

  // Budget ceiling.
  const capped_notional = Math.min(ideal_notional_dusdc, input.budget_remaining_dusdc);
  const is_partial = capped_notional < ideal_notional_dusdc;
  const shortfall = is_partial ? ideal_notional_dusdc - capped_notional : 0;

  const actual_dbtc = capped_notional / input.spot_price_usd;
  const friction = (friction_bps / 10_000) * capped_notional * 2; // round-trip

  // Direction: opposite of house exposure.
  // house_net_delta < 0 → house is net short → hedge is LONG (buy BTC to offset).
  // house_net_delta > 0 → house is net long → hedge is SHORT (sell BTC to offset).
  const direction: 'long' | 'short' = input.house_net_delta < 0 ? 'long' : 'short';

  return {
    direction,
    size_dbtc: actual_dbtc,
    notional_dusdc: capped_notional,
    friction_cost_dusdc: friction,
    is_partial,
    shortfall_dusdc: shortfall,
    skipped: false,
  };
}

/**
 * P&L of an executed hedge position over one expiry.
 *
 * For a long hedge:  P&L = +size × (settlement - entry) - friction
 * For a short hedge: P&L = -size × (settlement - entry) - friction
 * For no hedge:      P&L = 0
 *
 * @param order     The HedgeOrder placed at oracle activation.
 * @param entry_usd BTC spot price when the hedge was placed.
 * @param exit_usd  BTC spot price at oracle settlement.
 */
export function hedgePnl(order: HedgeOrder, entry_usd: number, exit_usd: number): number {
  if (order.skipped || order.direction === 'none') return 0;
  const spot_pnl = order.direction === 'long'
    ? order.size_dbtc * (exit_usd - entry_usd)
    : -order.size_dbtc * (exit_usd - entry_usd);
  return spot_pnl - order.friction_cost_dusdc;
}
