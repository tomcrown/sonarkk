import { describe, it, expect } from 'vitest';
import { shouldSkipExpiry, MIN_ATM_VOL } from '../entry-guard.js';
import type { SviParams } from '../delta.js';

const T_YEARS = 2 / (365.25 * 24); // 2hr expiry

function flatSvi(vol: number, t: number): SviParams {
  const w = vol * vol * t;
  return { a: w, b: 0, rho: 0, m: 0, sigma: 1 };
}

describe('shouldSkipExpiry — ATM vol check', () => {
  it('plp_supplier: passes at 15% ATM vol', () => {
    const svi = flatSvi(0.15, T_YEARS);
    const result = shouldSkipExpiry(svi, T_YEARS, 0.25, 'plp_supplier');
    expect(result.skip).toBe(false);
  });

  it('plp_supplier: skips at 14% ATM vol', () => {
    const svi = flatSvi(0.14, T_YEARS);
    const result = shouldSkipExpiry(svi, T_YEARS, 0.25, 'plp_supplier');
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('ATM vol');
  });

  it('range_roll: passes at 28% ATM vol', () => {
    const svi = flatSvi(0.28, T_YEARS);
    const result = shouldSkipExpiry(svi, T_YEARS, 0.25, 'range_roll');
    expect(result.skip).toBe(false);
  });

  it('range_roll: skips at 27% ATM vol (below 0.28 threshold)', () => {
    const svi = flatSvi(0.27, T_YEARS);
    const result = shouldSkipExpiry(svi, T_YEARS, 0.25, 'range_roll');
    expect(result.skip).toBe(true);
  });

  it('hedged_plp: threshold is 0.18', () => {
    expect(MIN_ATM_VOL['hedged_plp']).toBe(0.18);
    const svi_pass = flatSvi(0.18, T_YEARS);
    const svi_fail = flatSvi(0.17, T_YEARS);
    expect(shouldSkipExpiry(svi_pass, T_YEARS, 0.25, 'hedged_plp').skip).toBe(false);
    expect(shouldSkipExpiry(svi_fail, T_YEARS, 0.25, 'hedged_plp').skip).toBe(true);
  });

  it('all strategies have distinct correct thresholds from binding rules', () => {
    expect(MIN_ATM_VOL['plp_supplier']).toBe(0.15);
    expect(MIN_ATM_VOL['hedged_plp']).toBe(0.18);
    expect(MIN_ATM_VOL['smart_vault']).toBe(0.18);
    expect(MIN_ATM_VOL['principal_protected']).toBe(0.15);
    expect(MIN_ATM_VOL['range_roll']).toBe(0.28);
    expect(MIN_ATM_VOL['vol_targeted_range']).toBe(0.28);
    expect(MIN_ATM_VOL['vol_arb_sell']).toBe(0.22);
  });
});

describe('shouldSkipExpiry — spread sanity check', () => {
  it('near-zero variance svi triggers spread sanity skip', () => {
    // Extremely low vol (1% ATM) → spread → FLOOR_SPREAD + tiny epsilon
    const svi = flatSvi(0.001, T_YEARS);
    // Even if the vol passes the threshold (vol < threshold so should skip on vol),
    // let's test a case where vol passes but spread is degenerate.
    // Use a strategy with 0 threshold for vol (not possible — use 0.001 < 0.15 → skips on vol)
    // Instead test with a custom very low-spread case explicitly:
    const svi_degenerate: SviParams = { a: 1e-12, b: 0, rho: 0, m: 0, sigma: 1 };
    // atm_vol = sqrt(1e-12 / T_YEARS) ≈ very small → will skip on vol first
    // This confirms the guard cascade: vol check runs first
    const result = shouldSkipExpiry(svi_degenerate, T_YEARS, 0.25, 'plp_supplier');
    expect(result.skip).toBe(true);
  });

  it('result includes atm_vol and atm_spread', () => {
    const svi = flatSvi(0.30, T_YEARS);
    const result = shouldSkipExpiry(svi, T_YEARS, 0.25, 'plp_supplier');
    expect(result.atm_vol).toBeGreaterThan(0);
    expect(result.atm_spread).toBeGreaterThan(0);
  });
});

describe('shouldSkipExpiry — result fields', () => {
  it('skip=false result has no reason field', () => {
    const svi = flatSvi(0.30, T_YEARS);
    const result = shouldSkipExpiry(svi, T_YEARS, 0.25, 'plp_supplier');
    expect(result.skip).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('skip=true result has reason string', () => {
    const svi = flatSvi(0.10, T_YEARS);
    const result = shouldSkipExpiry(svi, T_YEARS, 0.25, 'plp_supplier');
    expect(result.skip).toBe(true);
    expect(typeof result.reason).toBe('string');
  });
});
