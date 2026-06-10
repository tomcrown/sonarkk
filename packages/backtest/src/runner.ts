/**
 * Backtest runner.
 * 1. Fetches + caches all settled oracle records (predict-server).
 * 2. Runs SVI calibration check on a sample of records.
 * 3. Runs sensitivity analysis (all strategies × 3 util levels).
 * 4. Returns the BacktestOutput.
 */
import { fetchOracleRecords } from './data/fetcher.js';
import { calibrateSvi } from './engine/svi.js';
import { runSensitivity } from './metrics/sensitivity.js';
import type { BacktestOutput, OracleRecord } from './data/types.js';

function printCalibration(records: OracleRecord[]): void {
  // Sample 10 evenly-spaced records for calibration report.
  const step = Math.max(1, Math.floor(records.length / 10));
  const sample = records.filter((_, i) => i % step === 0).slice(0, 10);

  console.log('\n── SVI Calibration Check (10 sampled oracles) ──');
  console.log('  oracle_id                     ATM vol%  Skew(bps)  p(ATM call)  Suspicious');
  for (const rec of sample) {
    const c = calibrateSvi(rec.svi, rec.t_years);
    const flag = c.suspicious ? '⚠' : '✓';
    console.log(
      `  ${rec.oracle_id.slice(0, 28)}  ${c.atm_vol_pct.toFixed(1).padStart(7)}%  ` +
        `${c.skew_bps.toFixed(0).padStart(9)}  ${c.prob_atm_call.toFixed(3).padStart(11)}  ${flag}`,
    );
  }
  const vols = sample.map(s => calibrateSvi(s.svi, s.t_years).atm_vol_pct).sort((a, b) => a - b);
  const vol_median = vols[Math.floor(vols.length / 2)] ?? 0;
  console.log(`  Median ATM implied vol: ${vol_median.toFixed(1)}%`);
}

export async function runBacktest(): Promise<BacktestOutput> {
  console.log('=== Sonark Phase 1 — Backtest Engine ===\n');

  // Step 1: Data.
  console.log('Step 1: Fetching oracle records...');
  const records = await fetchOracleRecords();
  if (records.length === 0) throw new Error('No oracle records fetched — check predict-server connectivity.');
  console.log(`  Loaded ${records.length} settled oracle records`);
  const firstRecord = records[0];
  const lastRecord = records[records.length - 1];
  console.log(`  Period: ${new Date(firstRecord?.expiry_ms ?? 0).toISOString()} → ${new Date(lastRecord?.expiry_ms ?? 0).toISOString()}`);
  console.log(`  Forward price range: $${Math.min(...records.map(r => r.forward_usd)).toFixed(0)} – $${Math.max(...records.map(r => r.forward_usd)).toFixed(0)}`);

  // Step 2: SVI calibration.
  console.log('\nStep 2: SVI calibration check...');
  printCalibration(records);

  // Step 3: Sensitivity analysis.
  console.log('\nStep 3: Running strategy simulations...');
  const output = runSensitivity(records);

  return output;
}
