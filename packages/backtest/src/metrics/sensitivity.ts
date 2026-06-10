/**
 * Sensitivity runner: executes every strategy at three utilization levels
 * and aggregates results into a BacktestOutput.
 */
import { computeMetrics, verdict, realizedVol } from './calculator.js';
import type { OracleRecord, StrategyResult, BacktestOutput } from '../data/types.js';
import type { SimConfig } from '../strategies/types.js';
import { DEFAULT_CONFIG } from '../strategies/types.js';
import { simulatePlpSupplier } from '../strategies/plp-supplier.js';
import { simulateHedgedPlp } from '../strategies/hedged-plp.js';
import { simulateSmartVault } from '../strategies/smart-vault.js';
import { simulatePrincipalProtected } from '../strategies/principal-protected.js';
import { simulateRangeRoll } from '../strategies/range-roll.js';
import { simulateVolTargetedRange } from '../strategies/vol-targeted-range.js';
import { simulateVolArb } from '../strategies/vol-arb.js';
import { simulateDirectional } from '../strategies/directional.js';

const UTILIZATION_LEVELS = [0.05, 0.25, 0.60];

type Simulator = (records: OracleRecord[], config: SimConfig) => ReturnType<typeof simulatePlpSupplier>;
type StrategyType = 'house' | 'bettor';

interface StrategySpec {
  id: string;
  name: string;
  type: StrategyType;
  simulate: Simulator;
}

const STRATEGIES: StrategySpec[] = [
  { id: 'plp_supplier', name: '① PLP Supplier', type: 'house', simulate: simulatePlpSupplier },
  { id: 'hedged_plp', name: '② Hedged-PLP', type: 'house', simulate: simulateHedgedPlp },
  { id: 'smart_vault', name: '③ Smart Vault', type: 'house', simulate: simulateSmartVault },
  { id: 'principal_protected', name: '④ Principal-Protected', type: 'bettor', simulate: simulatePrincipalProtected },
  { id: 'range_roll', name: '⑤ Range-Roll', type: 'bettor', simulate: simulateRangeRoll },
  { id: 'vol_targeted_range', name: '⑥ Vol-Targeted Range', type: 'bettor', simulate: simulateVolTargetedRange },
  { id: 'vol_arb', name: '⑦ Vol-Arb', type: 'bettor', simulate: simulateVolArb },
  { id: 'directional', name: '⑧ Directional (negative control)', type: 'bettor', simulate: simulateDirectional },
];

export function runSensitivity(records: OracleRecord[]): BacktestOutput {
  console.log(`\nRunning sensitivity analysis on ${records.length} oracle records...`);
  const allResults: StrategyResult[] = [];

  for (const spec of STRATEGIES) {
    for (const util of UTILIZATION_LEVELS) {
      const config: SimConfig = { ...DEFAULT_CONFIG, utilization: util };
      process.stdout.write(`  ${spec.name} @ ${(util * 100).toFixed(0)}% util... `);

      const rounds = spec.simulate(records, config);
      const metrics = computeMetrics(rounds, records);
      const v = verdict(metrics, spec.type);

      console.log(
        `APY=${(metrics.net_apy * 100).toFixed(1)}%  DD=${(metrics.max_drawdown * 100).toFixed(1)}%  Sharpe=${metrics.sharpe.toFixed(2)}  → ${v}`,
      );

      allResults.push({
        strategy_id: `${spec.id}_util${(util * 100).toFixed(0)}`,
        strategy_name: `${spec.name} @ ${(util * 100).toFixed(0)}% util`,
        utilization: util,
        rounds,
        net_apy: metrics.net_apy,
        max_drawdown: metrics.max_drawdown,
        sharpe: metrics.sharpe,
        win_rate: metrics.win_rate,
        spread_cost_pct: metrics.spread_cost_pct,
        verdict: v,
      });
    }
  }

  // Realized vol from BTC settlement price series.
  const prices = records.map((r) => r.settlement_price_usd);
  const t_per = records[0]?.t_years ?? 1 / (365 * 96);
  const rvol = realizedVol(prices, t_per);

  return {
    generated_at: new Date().toISOString(),
    oracle_count: records.length,
    period_start: new Date(records[0]?.expiry_ms ?? 0).toISOString(),
    period_end: new Date(records[records.length - 1]?.expiry_ms ?? 0).toISOString(),
    realized_btc_vol: rvol,
    strategies: allResults,
  };
}
