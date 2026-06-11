import { describe, it, expect } from 'vitest';
import {
  Phi, phi, sviW, binaryCallProb, atmVol,
  binaryCallDeltaNorm, computeHouseNetDelta,
  computeHouseNetDeltaSynthetic, computeNetDelta,
} from '../delta.js';
import type { SviParams } from '../delta.js';

// Hand-checked flat SVI: a=w, b=0, rho=0, m=0, sigma=1 → w(k) = a for all k
const FLAT_SVI = (vol: number, t: number): SviParams => {
  const w = vol * vol * t;
  return { a: w, b: 0, rho: 0, m: 0, sigma: 1 };
};

describe('Phi (standard normal CDF)', () => {
  it('Phi(0) ≈ 0.5', () => expect(Phi(0)).toBeCloseTo(0.5, 5));
  it('Phi(1.96) ≈ 0.975', () => expect(Phi(1.96)).toBeCloseTo(0.975, 2));
  it('Phi(-1.96) ≈ 0.025', () => expect(Phi(-1.96)).toBeCloseTo(0.025, 2));
  it('Phi(-8) = 0', () => expect(Phi(-8)).toBe(0));
  it('Phi(8) = 1', () => expect(Phi(8)).toBe(1));
});

describe('phi (standard normal PDF)', () => {
  it('phi(0) = 1/sqrt(2π)', () => expect(phi(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 8));
  it('phi(x) ≥ 0', () => expect(phi(3)).toBeGreaterThan(0));
});

describe('sviW', () => {
  it('flat SVI: w(k) = a for all k', () => {
    const svi = { a: 0.04, b: 0, rho: 0, m: 0, sigma: 1 };
    expect(sviW(svi, 0)).toBeCloseTo(0.04, 8);
    expect(sviW(svi, 0.5)).toBeCloseTo(0.04, 8);
    expect(sviW(svi, -0.5)).toBeCloseTo(0.04, 8);
  });

  it('non-trivial SVI curvature at k=0', () => {
    const svi: SviParams = { a: 0.01, b: 0.5, rho: 0, m: 0, sigma: 0.1 };
    // w(0) = 0.01 + 0.5*(0 + sqrt(0 + 0.01)) = 0.01 + 0.05 = 0.06
    expect(sviW(svi, 0)).toBeCloseTo(0.06, 6);
  });
});

describe('binaryCallProb', () => {
  it('ATM k=0 flat vol: prob ≈ 0.5 (d₂ = −√w/2)', () => {
    // For flat vol=20%, T=1: w=0.04, √w=0.2, d₂ = 0 - 0.2/2 = -0.1 → Φ(-0.1) ≈ 0.460
    const svi = FLAT_SVI(0.20, 1);
    const p = binaryCallProb(svi, 0);
    expect(p).toBeCloseTo(Phi(-0.1), 5);
  });

  it('deep ITM k << 0: prob → 1', () => {
    const svi = FLAT_SVI(0.20, 1);
    expect(binaryCallProb(svi, -3)).toBeGreaterThan(0.99);
  });

  it('deep OTM k >> 0: prob → 0', () => {
    const svi = FLAT_SVI(0.20, 1);
    expect(binaryCallProb(svi, 3)).toBeLessThan(0.01);
  });
});

describe('atmVol', () => {
  it('recovers implied vol from flat SVI', () => {
    const svi = FLAT_SVI(0.35, 1 / 12); // 35% vol, 1 month
    expect(atmVol(svi, 1 / 12)).toBeCloseTo(0.35, 5);
  });
});

describe('binaryCallDeltaNorm', () => {
  it('flat SVI: Δ_norm = phi(d₂)/√w > 0', () => {
    const svi = FLAT_SVI(0.30, 2 / (365.25 * 24)); // 2hr expiry
    const d = binaryCallDeltaNorm(svi, 0);
    expect(d).toBeGreaterThan(0);
  });

  it('delta at ATM hand check: vol=30%, T=2hr', () => {
    const T = 2 / (365.25 * 24);
    const svi = FLAT_SVI(0.30, T);
    const w = 0.09 * T;
    const sqrtW = Math.sqrt(w);
    const d2 = -sqrtW / 2;
    const expected = phi(d2) / sqrtW;
    expect(binaryCallDeltaNorm(svi, 0)).toBeCloseTo(expected, 6);
  });
});

describe('computeHouseNetDelta', () => {
  it('balanced book (50/50 calls/puts): net delta ≈ 0', () => {
    const svi = FLAT_SVI(0.30, 2 / (365.25 * 24));
    const spot = 75000;
    const notional = 10000;
    const strikes = [{ k: 0, call_notional: notional / 2, put_notional: notional / 2 }];
    const delta = computeHouseNetDelta(svi, spot, strikes);
    expect(delta).toBeCloseTo(0, 10); // exactly 0 by symmetry
  });

  it('55/45 call/put book: house net delta < 0 (short delta)', () => {
    const svi = FLAT_SVI(0.30, 2 / (365.25 * 24));
    const spot = 75000;
    const notional = 10000;
    const strikes = [{ k: 0, call_notional: notional * 0.55, put_notional: notional * 0.45 }];
    const delta = computeHouseNetDelta(svi, spot, strikes);
    expect(delta).toBeLessThan(0); // house is short delta — needs to buy BTC to hedge
  });

  it('45/55 call/put book: house net delta > 0 (long delta)', () => {
    const svi = FLAT_SVI(0.30, 2 / (365.25 * 24));
    const spot = 75000;
    const notional = 10000;
    const strikes = [{ k: 0, call_notional: notional * 0.45, put_notional: notional * 0.55 }];
    const delta = computeHouseNetDelta(svi, spot, strikes);
    expect(delta).toBeGreaterThan(0);
  });

  it('sign: net_delta = Δ_norm×(put_notional−call_notional)/spot', () => {
    const T = 2 / (365.25 * 24);
    const svi = FLAT_SVI(0.30, T);
    const spot = 75000;
    const call_notional = 5500;
    const put_notional = 4500;
    const k = 0;
    const strikes = [{ k, call_notional, put_notional }];
    const delta = computeHouseNetDelta(svi, spot, strikes);
    const expected = binaryCallDeltaNorm(svi, k) * (put_notional - call_notional) / spot;
    expect(delta).toBeCloseTo(expected, 10);
  });
});

describe('computeHouseNetDeltaSynthetic convenience wrapper', () => {
  it('matches manual computeHouseNetDelta', () => {
    const T = 2 / (365.25 * 24);
    const svi = FLAT_SVI(0.30, T);
    const spot = 75000;
    const atm_vol_sqrt_t = 0.30 * Math.sqrt(T);
    const offsets = [0];
    const weights = [1];
    const call_frac = 0.55;
    const notional = 10000;

    const synth = computeHouseNetDeltaSynthetic(svi, spot, atm_vol_sqrt_t, offsets, weights, call_frac, notional);

    const strikes = [{ k: 0, call_notional: notional * call_frac, put_notional: notional * (1 - call_frac) }];
    const manual = computeHouseNetDelta(svi, spot, strikes);

    expect(synth).toBeCloseTo(manual, 10);
  });
});

describe('computeNetDelta (bettor view)', () => {
  it('long call: positive delta', () => {
    const svi = FLAT_SVI(0.30, 2 / (365.25 * 24));
    const delta = computeNetDelta(svi, 75000, [{ direction: 'call', notional: 1000, k: 0 }], []);
    expect(delta).toBeGreaterThan(0);
  });

  it('long put: negative delta', () => {
    const svi = FLAT_SVI(0.30, 2 / (365.25 * 24));
    const delta = computeNetDelta(svi, 75000, [{ direction: 'put', notional: 1000, k: 0 }], []);
    expect(delta).toBeLessThan(0);
  });

  it('house delta = −bettor delta', () => {
    const svi = FLAT_SVI(0.30, 2 / (365.25 * 24));
    const spot = 75000;
    const notional = 1000;
    const k = 0.1;
    const bettor_delta = computeNetDelta(svi, spot, [{ direction: 'call', notional, k }], []);
    const house_strikes = [{ k, call_notional: notional, put_notional: 0 }];
    const house_delta = computeHouseNetDelta(svi, spot, house_strikes);
    expect(house_delta).toBeCloseTo(-bettor_delta, 10);
  });
});
