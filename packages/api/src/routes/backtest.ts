/**
 * POST /backtest — Parameterized backtest endpoint (Module C).
 *
 * Returns per-round NAV series, vol-regime stress test, per-strategy
 * sensitivity (3 util levels), break-even vol for bettor strategies,
 * and full regime metrics (APY / Sharpe / DD / win-rate per regime).
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  fetchOracleRecords,
  computeMetrics,
  verdict,
  realizedVol,
  DEFAULT_CONFIG,
  simulatePlpSupplier,
  simulateHedgedPlp,
  simulateSmartVault,
  simulatePrincipalProtected,
  simulateRangeRoll,
  simulateVolTargetedRange,
  simulateVolArb,
  runRegimeAnalysis,
  breakEvenVol,
  UTIL_LEVELS,
} from '@sonarkk/backtest/lib';
import type { OracleRecord, SimConfig, RoundResult } from '@sonarkk/backtest/lib';

export const backtestRouter = Router();

// ── Validation ─────────────────────────────────────────────────────────────────

const VALID_STRATEGY_IDS = [
  'plp_supplier', 'hedged_plp', 'smart_vault', 'principal_protected',
  'range_roll', 'vol_targeted_range', 'vol_arb',
] as const;

type ValidStrategyId = (typeof VALID_STRATEGY_IDS)[number];

const RequestSchema = z.object({
  strategies:              z.array(z.enum(VALID_STRATEGY_IDS)).optional(),
  utilization:             z.number().min(0.01).max(1.0).optional(),
  mock_lending_apy:        z.number().min(0).max(0.5).optional(),
  deepbook_friction_bps:   z.number().min(0).max(100).optional(),
});

// ── Strategy registry ──────────────────────────────────────────────────────────

type Simulator = (records: OracleRecord[], config: SimConfig) => RoundResult[];
type StrategyClass = 'house' | 'bettor';

const STRATEGY_REGISTRY: Record<ValidStrategyId, {
  name: string;
  class: StrategyClass;
  simulate: Simulator;
  risk_disclosure: string | null;
}> = {
  plp_supplier: {
    name: '① PLP Supplier',
    class: 'house',
    simulate: simulatePlpSupplier,
    risk_disclosure: null,
  },
  hedged_plp: {
    name: '② Hedged-PLP',
    class: 'house',
    simulate: simulateHedgedPlp,
    risk_disclosure: null,
  },
  smart_vault: {
    name: '③ Smart Vault',
    class: 'house',
    simulate: simulateSmartVault,
    risk_disclosure: null,
  },
  principal_protected: {
    name: '④ Principal-Protected',
    class: 'house',
    simulate: simulatePrincipalProtected,
    risk_disclosure: null,
  },
  range_roll: {
    name: '⑤ Range-Roll',
    class: 'bettor',
    simulate: simulateRangeRoll,
    risk_disclosure: 'Short-volatility strategy — profitable in calm markets, LOSES IN VOLATILITY SPIKES. Backtest period was unusually calm (27.7% realized vol); results not indicative of typical performance.',
  },
  vol_targeted_range: {
    name: '⑥ Vol-Targeted Range',
    class: 'bettor',
    simulate: simulateVolTargetedRange,
    risk_disclosure: 'Short-volatility strategy with vol-targeting overlay. Reduces tail losses vs ⑤ but still loses in volatility spikes. Backtest period was unusually calm.',
  },
  vol_arb: {
    name: '⑦ Vol-Arb',
    class: 'bettor',
    simulate: simulateVolArb,
    risk_disclosure: 'Cross-venue vol-arb strategy. Edge depends on persistent vol mispricing between Predict and reference venues. Sell-vol mode only in current implementation.',
  },
};

const HOUSE_APY_CAVEAT = 'Modeled on synthetic/assumed trader flow — testnet has minimal real volume. House strategy returns depend on actual bettor activity, which is unavailable on testnet.';
const BETTOR_APY_CAVEAT = 'Backtest uses a single testnet period with unusually low realized vol (27.7%). At normal BTC vol (40–80%), bettor strategies show deeply negative returns. Do not extrapolate this result.';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a per-round NAV series from simulation output. Starting NAV = 100. */
function buildRoundSeries(rounds: RoundResult[]): Array<{ ms: number; nav: number; pnl_fraction: number }> {
  let nav = 100.0;
  return rounds.map((r) => {
    nav = nav * (1 + r.pnl_fraction);
    return { ms: r.expiry_ms, nav: +nav.toFixed(4), pnl_fraction: +r.pnl_fraction.toFixed(6) };
  });
}

/** Full per-regime metrics including Sharpe and MaxDD (not just APY + count). */
function regimeBreakdown(records: OracleRecord[], simulate: Simulator, config: SimConfig) {
  const calm   = records.filter(r => r.atm_vol < 0.25);
  const normal = records.filter(r => r.atm_vol >= 0.25 && r.atm_vol < 0.50);
  const high   = records.filter(r => r.atm_vol >= 0.50);

  const computeForSubset = (subset: OracleRecord[]) => {
    if (subset.length === 0) return null;
    const rounds = simulate(subset, config);
    const m = computeMetrics(rounds, subset);
    return {
      oracle_count:     subset.length,
      net_apy_pct:      +(m.net_apy * 100).toFixed(2),
      max_drawdown_pct: +(m.max_drawdown * 100).toFixed(2),
      sharpe:           +m.sharpe.toFixed(3),
      win_rate_pct:     m.win_rate != null ? +(m.win_rate * 100).toFixed(1) : null,
    };
  };

  return {
    calm_lt_25:   computeForSubset(calm),
    normal_25_50: computeForSubset(normal),
    high_gt_50:   computeForSubset(high),
  };
}

/** Sensitivity: run the given strategy at all 3 canonical util levels. */
function sensitivityForStrategy(
  records: OracleRecord[],
  simulate: Simulator,
  baseConfig: SimConfig,
) {
  return UTIL_LEVELS.map(u => {
    const cfg = { ...baseConfig, utilization: u };
    const rounds = simulate(records, cfg);
    const m = computeMetrics(rounds, records);
    return {
      util_pct:         Math.round(u * 100),
      net_apy_pct:      +(m.net_apy * 100).toFixed(2),
      max_drawdown_pct: +(m.max_drawdown * 100).toFixed(2),
      sharpe:           +m.sharpe.toFixed(3),
      win_rate_pct:     m.win_rate != null ? +(m.win_rate * 100).toFixed(1) : null,
    };
  });
}

// ── Route ──────────────────────────────────────────────────────────────────────

backtestRouter.post('/', async (req, res) => {
  const parsed = RequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { strategies, utilization, mock_lending_apy, deepbook_friction_bps } = parsed.data;

  const strategyIds: ValidStrategyId[] = (strategies ?? [...VALID_STRATEGY_IDS]) as ValidStrategyId[];
  const util = utilization ?? 0.25;

  const config: SimConfig = {
    ...DEFAULT_CONFIG,
    utilization: util,
    ...(mock_lending_apy != null     ? { mock_lending_apy }     : {}),
    ...(deepbook_friction_bps != null ? { deepbook_friction_bps } : {}),
  };

  try {
    const records = await fetchOracleRecords();
    if (records.length === 0) {
      res.status(503).json({ error: 'No oracle records available — predict-server unreachable' });
      return;
    }

    const prices = records.map(r => r.settlement_price_usd);
    const avgTYears = records.reduce((s, r) => s + r.t_years, 0) / Math.max(records.length, 1);
    const realizedVolAnnual = realizedVol(prices, avgTYears);
    const firstRecord = records[0]!;
    const lastRecord  = records[records.length - 1]!;

    // Vol stress test: run once for all records at the selected util level.
    const allStressRows = runRegimeAnalysis(records);
    const stressAtUtil = allStressRows.filter(r => Math.abs(r.util - util) < 0.01 || Math.abs(r.util - 0.25) < 0.01);
    // Pick closest util available in the stress rows
    const closestUtil = UTIL_LEVELS.reduce((a, b) => Math.abs(a - util) < Math.abs(b - util) ? a : b);
    const volStressTest = allStressRows
      .filter(r => Math.abs(r.util - closestUtil) < 0.001)
      .map(r => ({
        strategy:     r.strategy,
        sigma_pct:    +(r.sigma * 100).toFixed(1),
        vol_label:    r.vol_label.trim(),
        net_apy_pct:  +(r.net_apy * 100).toFixed(2),
        win_rate_pct: +(r.mean_win_rate * 100).toFixed(1),
        mode:         r.mode,
      }));

    // Break-even vol (averaged across all oracles at selected util).
    const breakEvenVolPct = +(breakEvenVol(records, util) * 100).toFixed(1);

    const strategyResults = strategyIds.map(stratId => {
      const spec = STRATEGY_REGISTRY[stratId];
      const rounds = spec.simulate(records, config);
      const metrics = computeMetrics(rounds, records);
      const v = verdict(metrics, spec.class);
      const regime = regimeBreakdown(records, spec.simulate, config);
      const roundSeries = buildRoundSeries(rounds);
      const sensitivity = sensitivityForStrategy(records, spec.simulate, config);
      const beVol = spec.class === 'bettor' ? breakEvenVolPct : null;

      return {
        strategy_id:      stratId,
        strategy_name:    spec.name,
        class:            spec.class,
        utilization_pct:  +(util * 100).toFixed(0),
        // Core metrics
        net_apy_pct:      +(metrics.net_apy * 100).toFixed(2),
        max_drawdown_pct: +(metrics.max_drawdown * 100).toFixed(2),
        sharpe:           +metrics.sharpe.toFixed(3),
        win_rate_pct:     metrics.win_rate != null ? +(metrics.win_rate * 100).toFixed(1) : null,
        spread_cost_pct:  metrics.spread_cost_pct != null ? +(metrics.spread_cost_pct * 100).toFixed(2) : null,
        verdict:          v,
        // Real per-round NAV series (starting at 100)
        round_results:    roundSeries,
        // Sensitivity at 3 util levels
        sensitivity,
        // Break-even realized vol (bettor strategies only)
        break_even_vol_pct: beVol,
        // Full regime breakdown
        regime,
        // Mandatory caveats
        apy_caveat:       spec.class === 'house' ? HOUSE_APY_CAVEAT : BETTOR_APY_CAVEAT,
        risk_disclosure:  spec.risk_disclosure,
      };
    });

    res.json({
      generated_at:         new Date().toISOString(),
      oracle_count:         records.length,
      period_start:         new Date(firstRecord.expiry_ms).toISOString(),
      period_end:           new Date(lastRecord.expiry_ms).toISOString(),
      realized_btc_vol_pct: +(realizedVolAnnual * 100).toFixed(1),
      config_used: {
        utilization_pct:       +(util * 100).toFixed(0),
        mock_lending_apy_pct:  +(config.mock_lending_apy * 100).toFixed(1),
        deepbook_friction_bps: config.deepbook_friction_bps,
      },
      // Vol stress test: 4 strategies × 4 vol scenarios at the selected util level
      vol_stress_test: volStressTest,
      global_caveat: 'All APY figures are modeled on testnet data with synthetic/assumed trader flow. Past testnet performance is not indicative of mainnet returns.',
      strategies: strategyResults,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
