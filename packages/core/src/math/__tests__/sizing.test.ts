import { describe, it, expect } from 'vitest';
import {
  sizePlpSupplier, sizeHedgedPlp, sizeSmartVault,
  sizePrincipalProtected, sizeRangeRoll,
  sizeVolTargetedRange, sizeVolArb,
  DEFAULT_HOUSE_UTIL, BETTOR_TARGET_VOL,
} from '../sizing.js';

// 1 DUSDC = 1_000_000 raw
const DUSDC = (n: number) => BigInt(Math.round(n * 1_000_000));

describe('sizePlpSupplier', () => {
  it('basic: size = available × util_target', () => {
    const r = sizePlpSupplier(DUSDC(10_000), DUSDC(999_999), DEFAULT_HOUSE_UTIL);
    expect(r.size_raw).toBe(DUSDC(10_000 * DEFAULT_HOUSE_UTIL));
    expect(r.is_budget_capped).toBe(false);
  });

  it('budget cap: size = min(ideal, budget)', () => {
    const r = sizePlpSupplier(DUSDC(10_000), DUSDC(100), DEFAULT_HOUSE_UTIL);
    expect(r.size_raw).toBe(DUSDC(100));
    expect(r.is_budget_capped).toBe(true);
    expect(r.ideal_size_raw).toBe(DUSDC(10_000 * DEFAULT_HOUSE_UTIL));
  });

  it('zero balance: skip', () => {
    const r = sizePlpSupplier(0n, DUSDC(1_000), DEFAULT_HOUSE_UTIL);
    expect(r.size_raw).toBe(0n);
    expect(r.skip_reason).toBeDefined();
  });

  it('utilization fraction correct', () => {
    const r = sizePlpSupplier(DUSDC(1_000), DUSDC(999_999), 0.25);
    expect(r.utilization_fraction).toBeCloseTo(0.25, 4);
  });
});

describe('sizeSmartVault', () => {
  it('splits budget proportionally (60/40)', () => {
    const available = DUSDC(100_000);
    const budget = DUSDC(999_999);
    const result = sizeSmartVault(available, budget, 0.6, 0.25);
    const total = result.hedged_plp.size_raw + result.plp_supplier.size_raw;
    // total ideal = 25% of 100k = 25k
    expect(total).toBeLessThanOrEqual(DUSDC(25_000) + 1n);
    expect(result.hedged_plp.size_raw > result.plp_supplier.size_raw).toBe(true);
  });
});

describe('sizePrincipalProtected', () => {
  it('only bets yield, not principal', () => {
    const yield_acc = DUSDC(500);
    const r = sizePrincipalProtected(yield_acc, DUSDC(999_999));
    expect(r.size_raw).toBeLessThanOrEqual(yield_acc);
  });

  it('zero yield: skip', () => {
    const r = sizePrincipalProtected(0n, DUSDC(1_000));
    expect(r.size_raw).toBe(0n);
    expect(r.skip_reason).toBeDefined();
  });

  it('bet_fraction applied correctly', () => {
    const yield_acc = DUSDC(1_000);
    const r = sizePrincipalProtected(yield_acc, DUSDC(999_999), 0.8);
    expect(r.size_raw).toBe(DUSDC(800));
  });
});

describe('sizeVolTargetedRange', () => {
  it('vol at target: full base size', () => {
    const r = sizeVolTargetedRange(DUSDC(10_000), DUSDC(999_999), BETTOR_TARGET_VOL, 0.25);
    expect(r.size_raw).toBe(DUSDC(10_000 * 0.25)); // vol_scale = 1.0
  });

  it('vol 2× target: half size', () => {
    const atm_vol = BETTOR_TARGET_VOL * 2; // 40%
    const r = sizeVolTargetedRange(DUSDC(10_000), DUSDC(999_999), atm_vol, 0.25);
    // vol_scale = min(1, 0.20/0.40) = 0.5
    const expected = DUSDC(10_000 * 0.25 * 0.5);
    expect(r.size_raw).toBe(expected);
  });

  it('vol below target: capped at 1× (never size up)', () => {
    const atm_vol = BETTOR_TARGET_VOL / 2; // 10%
    const r = sizeVolTargetedRange(DUSDC(10_000), DUSDC(999_999), atm_vol, 0.25);
    // vol_scale = min(1, 0.20/0.10) = min(1, 2) = 1.0
    expect(r.size_raw).toBe(DUSDC(10_000 * 0.25));
  });
});

describe('sizeVolArb', () => {
  it('full confidence: size = available × VOL_ARB_MAX_FRACTION', () => {
    const r = sizeVolArb(DUSDC(10_000), DUSDC(999_999), 1.0);
    // VOL_ARB_MAX_FRACTION = 0.10
    expect(r.size_raw).toBe(DUSDC(10_000 * 0.10));
  });

  it('zero confidence: size = 0', () => {
    const r = sizeVolArb(DUSDC(10_000), DUSDC(999_999), 0);
    expect(r.size_raw).toBe(0n);
  });

  it('confidence clamped to [0,1]', () => {
    const r_over = sizeVolArb(DUSDC(10_000), DUSDC(999_999), 2.0);
    const r_full = sizeVolArb(DUSDC(10_000), DUSDC(999_999), 1.0);
    expect(r_over.size_raw).toBe(r_full.size_raw);
  });

  it('budget cap applies', () => {
    const r = sizeVolArb(DUSDC(10_000), DUSDC(50), 1.0);
    expect(r.size_raw).toBe(DUSDC(50));
    expect(r.is_budget_capped).toBe(true);
  });
});
