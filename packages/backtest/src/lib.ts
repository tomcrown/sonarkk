/**
 * lib.ts — Public library interface for @sonarkk/backtest.
 *
 * Used by the API package (packages/api) to run parameterized backtests
 * and access backtest types. This is separate from index.ts (the CLI entry point).
 */

export { fetchOracleRecords } from './data/fetcher.js';
export { runSensitivity } from './metrics/sensitivity.js';
export { computeMetrics, verdict, realizedVol } from './metrics/calculator.js';
export { calibrateSvi } from './engine/svi.js';
export { DEFAULT_CONFIG } from './strategies/types.js';

export type { OracleRecord, StrategyResult, BacktestOutput, SviParams, RoundResult } from './data/types.js';
export type { SimConfig } from './strategies/types.js';

// Individual strategy simulators (for custom per-strategy backtest requests)
export { simulatePlpSupplier }     from './strategies/plp-supplier.js';
export { simulateHedgedPlp }       from './strategies/hedged-plp.js';
export { simulateSmartVault }      from './strategies/smart-vault.js';
export { simulatePrincipalProtected } from './strategies/principal-protected.js';
export { simulateRangeRoll }       from './strategies/range-roll.js';
export { simulateVolTargetedRange } from './strategies/vol-targeted-range.js';
export { simulateVolArb }          from './strategies/vol-arb.js';

export { runRegimeAnalysis, breakEvenVol, VOL_SCENARIOS, UTIL_LEVELS } from './analysis/regime.js';
export type { RegimeRow } from './analysis/regime.js';
