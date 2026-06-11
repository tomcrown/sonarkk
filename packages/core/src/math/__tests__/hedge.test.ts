import { describe, it, expect } from 'vitest';
import { computeHedgeOrder, hedgePnl } from '../hedge.js';
import { MIN_T_YEARS_FOR_HEDGE } from '../delta.js';

// house_net_delta is in DBTC (not DUSDC/dollar).
// Derivation: Δ_norm × notional/spot = dimensionless × DUSDC/(DUSDC/DBTC) = DBTC.
//
// For a 25k DUSDC active book at 55/45 call/put split, 27.7% vol, 2hr:
//   Δ_norm_ATM ≈ 95, net_delta ≈ -1.97 DBTC → ideal_notional ≈ $148k.
//
// BASE uses house_net_delta = -2.0 DBTC (realistic PLP book value).
// ideal_notional = 2.0 * 75000 = $150k >> budget 5k → always budget-capped.
// Direction and PnL direction tests remain valid even when budget-capped.
const BASE = {
  house_net_delta: -2.0, // DBTC, short delta → hedge should be LONG
  spot_price_usd: 75_000,
  t_years: 2 / (365.25 * 24),
  budget_remaining_dusdc: 5_000,
  friction_bps: 8,
};

describe('computeHedgeOrder direction', () => {
  it('short delta (net_delta < 0) → LONG BTC hedge', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -2.0 });
    expect(order.direction).toBe('long');
    expect(order.skipped).toBe(false);
  });

  it('long delta (net_delta > 0) → SHORT BTC hedge', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: 2.0 });
    expect(order.direction).toBe('short');
    expect(order.skipped).toBe(false);
  });

  it('zero delta → skip', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: 0 });
    expect(order.skipped).toBe(true);
    expect(order.direction).toBe('none');
    expect(order.size_dbtc).toBe(0);
  });
});

describe('computeHedgeOrder sizing', () => {
  // Use house_net_delta = -0.05 DBTC so ideal_notional = 0.05*75000 = 3750 < budget 5000 (no cap)
  it('size_dbtc = |net_delta| (already in DBTC, no division by spot)', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -0.05 });
    expect(order.size_dbtc).toBeCloseTo(0.05, 10);
    expect(order.is_partial).toBe(false);
  });

  it('notional_dusdc = size_dbtc × spot', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -0.01 });
    // ideal_dbtc = 0.01, ideal_notional = 0.01*75000 = 750 DUSDC (within budget)
    expect(order.notional_dusdc).toBeCloseTo(order.size_dbtc * BASE.spot_price_usd, 6);
    expect(order.notional_dusdc).toBeCloseTo(750, 4);
  });

  it('budget cap: if ideal_notional > budget, cap at budget', () => {
    // house_net_delta = -2000 DBTC → ideal_notional = 2000*75000 = 150M >> 1000 budget
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -2_000, budget_remaining_dusdc: 1_000 });
    expect(order.is_partial).toBe(true);
    expect(order.notional_dusdc).toBeCloseTo(1_000, 6);
    expect(order.shortfall_dusdc).toBeGreaterThan(0);
  });

  it('no cap: is_partial = false when ideal_notional < budget', () => {
    // house_net_delta = -0.001 DBTC → ideal_notional = 75 DUSDC < budget 5000
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -0.001 });
    expect(order.is_partial).toBe(false);
    expect(order.shortfall_dusdc).toBe(0);
  });
});

describe('computeHedgeOrder friction', () => {
  it('friction = notional × bps/10000 × 2 (round-trip)', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -0.01 });
    const expected = order.notional_dusdc * (8 / 10_000) * 2;
    expect(order.friction_cost_dusdc).toBeCloseTo(expected, 8);
  });
});

describe('computeHedgeOrder near-expiry scale', () => {
  it('at t=0, order is skipped (ideal_dbtc scaled to zero → below min notional)', () => {
    const order = computeHedgeOrder({
      ...BASE,
      t_years: 0,
      house_net_delta: -0.001,
    });
    expect(order.skipped).toBe(true);
  });

  it('above MIN_T_YEARS_FOR_HEDGE: full scale, not skipped (may be budget-capped but not skipped)', () => {
    const order = computeHedgeOrder({ ...BASE, t_years: MIN_T_YEARS_FOR_HEDGE * 2 });
    expect(order.skipped).toBe(false);
  });
});

describe('hedgePnl', () => {
  it('long hedge: PnL = +size × (exit - entry) - friction', () => {
    // BASE: budget-capped at 5000 → size_dbtc = 5000/75000 = 0.0667 DBTC
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -2.0 });
    const entry = 75_000;
    const exit = 76_000;
    const pnl = hedgePnl(order, entry, exit);
    const expected = order.size_dbtc * (exit - entry) - order.friction_cost_dusdc;
    expect(pnl).toBeCloseTo(expected, 8);
  });

  it('long hedge: BTC rises → positive PnL (offsets house short-delta loss)', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -2.0 });
    // BTC up $1000: gain = 0.0667 * 1000 = 66.7, friction = 8 → net ≈ 58.7 > 0
    expect(hedgePnl(order, 75_000, 76_000)).toBeGreaterThan(0);
  });

  it('short hedge: BTC falls → positive PnL', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: 2.0 });
    // BTC down $1000: short gain = 0.0667 * 1000 = 66.7, friction = 8 → net ≈ 58.7 > 0
    expect(hedgePnl(order, 75_000, 74_000)).toBeGreaterThan(0);
  });

  it('skipped hedge: PnL = 0', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: 0 });
    expect(hedgePnl(order, 75_000, 76_000)).toBe(0);
  });

  it('long hedge: BTC falls → negative PnL (hedge position lost)', () => {
    const order = computeHedgeOrder({ ...BASE, house_net_delta: -2.0 });
    // BTC down $1000: loss = -0.0667 * 1000 - 8 = -74.7 < 0
    expect(hedgePnl(order, 75_000, 74_000)).toBeLessThan(0);
  });
});
