/**
 * Rule 5 stress test validation.
 *
 * This test RUNS the stress test and validates structural properties.
 * It does NOT assert that the hedge is effective at every vol level — that is a
 * finding to surface. Instead it:
 *   1. Confirms the test actually runs (N=50,000 samples per regime).
 *   2. Confirms house is profitable on average (positive mean P&L) due to spread.
 *   3. Confirms hedge direction is LONG at 55/45 (short-delta house book).
 *   4. Reports hedge effectiveness per regime — test PASSES if the finding
 *      (effective or not) is clearly visible, not if it shows a specific value.
 *
 * The actual hedge effectiveness numbers are the deliverable for human review.
 */

import { describe, it, expect } from 'vitest';
import { runRule5StressTest, formatRule5Table } from '../stress-test.js';

describe('Rule 5 high-vol hedge stress test', () => {
  const results = runRule5StressTest();

  it('returns exactly 4 vol regimes', () => {
    expect(results).toHaveLength(4);
  });

  it('sigma levels match expected regimes', () => {
    const sigmas = results.map((r) => r.sigma_pct);
    expect(sigmas[0]).toBeCloseTo(27.7, 0);
    expect(sigmas[1]).toBeCloseTo(40, 0);
    expect(sigmas[2]).toBeCloseTo(60, 0);
    expect(sigmas[3]).toBeCloseTo(80, 0);
  });

  it('sample count is correct', () => {
    for (const r of results) {
      expect(r.n_samples).toBe(50_000);
    }
  });

  it('house earns positive mean P&L in all regimes (structural spread edge)', () => {
    for (const r of results) {
      // House always collects the spread, so mean P&L should be > 0.
      // If this fails, the P&L formula is wrong.
      expect(r.unhedged_mean_pnl).toBeGreaterThan(0);
    }
  });

  it('hedge direction is LONG at 55/45 call/put book (house is short delta)', () => {
    for (const r of results) {
      expect(r.hedge_direction).toBe('long');
    }
  });

  it('hedge cost is positive and small relative to vault notional', () => {
    for (const r of results) {
      expect(r.mean_friction_cost_dusdc).toBeGreaterThan(0);
      // friction << vault notional (100k)
      expect(r.mean_friction_cost_dusdc).toBeLessThan(100);
    }
  });

  it('P5 worst-case loss is worse at higher vol regimes (unhedged)', () => {
    // Higher vol → wider swings → worse worst-case
    const p5s = results.map((r) => r.unhedged_p5_pnl);
    for (let i = 1; i < p5s.length; i++) {
      expect(p5s[i]!).toBeLessThan(p5s[i - 1]!);
    }
  });

  it('prints Rule 5 table for human review', () => {
    const table = formatRule5Table(results);
    console.log('\n--- Rule 5: Hedged-PLP High-Vol Stress Test ---');
    console.log(table);
    console.log('\nDetailed results:');
    for (const r of results) {
      console.log(
        `σ=${r.sigma_pct.toFixed(1)}%: ` +
        `mean_pnl=${r.unhedged_mean_pnl.toFixed(2)} | ` +
        `unhedged_p5=${r.unhedged_p5_pnl.toFixed(2)} | ` +
        `hedged_p5=${r.hedged_p5_pnl.toFixed(2)} | ` +
        `drawdown_reduction=${r.drawdown_reduction_dusdc.toFixed(2)} | ` +
        `friction=${r.mean_friction_cost_dusdc.toFixed(4)} | ` +
        `effective=${r.hedge_effective ? 'YES' : 'NO (FINDING)'}`,
      );
    }
    expect(table).toContain('|');
  });
});
