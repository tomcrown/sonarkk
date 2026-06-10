/**
 * Predict protocol spread formula (exact, from CLAUDE.md §6).
 *
 * spread = max(BASE_SPREAD × sqrt(p × (1-p)) × util_multiplier, FLOOR_SPREAD)
 *
 * where:
 *   BASE_SPREAD     = 0.02  (2%)
 *   FLOOR_SPREAD    = 0.005 (0.5%)
 *   util_multiplier = 1 + (utilization / MAX_UTIL)  capped at 2
 *   MAX_UTIL        = 0.80  (80% exposure cap per CLAUDE.md §6)
 *
 * p = risk-neutral probability of the bet winning.
 *
 * The bettor pays:  cost = p + spread  (per unit notional)
 * The house receives: p + spread, pays 1 if bet wins.
 * Expected house P&L per unit = spread + (p - p_realized).
 */

const BASE_SPREAD = 0.02;
const FLOOR_SPREAD = 0.005;
// Utilization at which the multiplier reaches its cap of ×2.
const MAX_UTIL_FOR_CAP = 0.80;

/**
 * Compute the spread for a bet with winning probability p.
 *
 * @param p      Risk-neutral probability of winning [0, 1]
 * @param util   Current utilization of the PLP vault [0, 1]
 */
export function computeSpread(p: number, util: number): number {
  // Utilization multiplier: linear from 1 (util=0) to 2 (util=MAX_UTIL_FOR_CAP).
  const util_multiplier = Math.min(2, 1 + util / MAX_UTIL_FOR_CAP);
  const spread = BASE_SPREAD * Math.sqrt(p * (1 - p)) * util_multiplier;
  return Math.max(spread, FLOOR_SPREAD);
}

/**
 * Expected house P&L per unit notional for a binary bet.
 *
 * @param p          Risk-neutral probability (pricing probability)
 * @param p_realized Realized probability (did this type of bet actually win?)
 * @param util       Current vault utilization
 */
export function houseExpectedPnl(p: number, p_realized: number, util: number): number {
  const spread = computeSpread(p, util);
  // E[house P&L] = spread + (p - p_realized)
  // Positive when protocol prices accurately or overestimates win probability.
  return spread + (p - p_realized);
}

/**
 * Simulate one bet from the HOUSE perspective.
 * Returns the actual P&L (not expected) for one outcome.
 *
 * @param p       Risk-neutral probability
 * @param util    Utilization
 * @param won     Whether the bettor won
 * @param notional DUSDC amount at stake
 */
export function houseBetPnl(
  p: number,
  util: number,
  won: boolean,
  notional: number,
): number {
  const spread = computeSpread(p, util);
  const cost_paid_by_bettor = p + spread;
  if (won) {
    // House paid out 1, received cost_paid_by_bettor
    return (cost_paid_by_bettor - 1) * notional;
  } else {
    // House received cost_paid_by_bettor, paid 0
    return cost_paid_by_bettor * notional;
  }
}

/**
 * Simulate one bet from the BETTOR perspective.
 *
 * @param p       Risk-neutral probability
 * @param util    Utilization
 * @param won     Whether the bettor won
 * @param notional DUSDC amount wagered (i.e., the cost paid)
 */
export function bettorBetPnl(
  p: number,
  util: number,
  won: boolean,
  notional: number,
): number {
  const spread = computeSpread(p, util);
  const cost_per_unit = p + spread;
  const units = notional / cost_per_unit; // how many units bought
  if (won) {
    // Bettor receives 1 per unit, paid cost_per_unit per unit.
    return (1 - cost_per_unit) * units;
  } else {
    // Bettor receives 0, loses cost paid.
    return -notional;
  }
}
