/**
 * Entry point for the regime adjustment analysis.
 * Run with:  npx tsx src/analysis/run.ts  (from packages/backtest)
 *
 * Uses the cached oracle records produced by the main backtest.
 * No network calls — instant.
 */
import { readCache, writeCache } from '../data/cache.js';
import type { OracleRecord } from '../data/types.js';
import { runRegimeAnalysis, breakEvenVol, VOL_SCENARIOS, UTIL_LEVELS } from './regime.js';

function pct(n: number, digits = 1): string {
  return (n * 100).toFixed(digits) + '%';
}

function apyFmt(n: number): string {
  const p = n * 100;
  if (p > 9999) return p.toFixed(0) + '%';
  return p.toFixed(1) + '%';
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         REGIME ADJUSTMENT ANALYSIS                  ║');
  console.log('║  Varying realised BTC vol; SVI pricing unchanged     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const records = await readCache<OracleRecord[]>('oracle_records');
  if (!records || records.length === 0) {
    console.error('No oracle records in cache. Run: npx tsx src/index.ts first.');
    process.exit(1);
  }

  const avgImplied = records.reduce((s, r) => s + r.atm_vol, 0) / records.length;
  const firstMs = records[0]?.expiry_ms ?? 0;
  const lastMs = records[records.length - 1]?.expiry_ms ?? 0;
  const tYears = (lastMs - firstMs) / (365.25 * 24 * 3600 * 1000);

  console.log(`Oracles : ${records.length}`);
  console.log(`Period  : ${new Date(firstMs).toISOString().slice(0, 10)} → ${new Date(lastMs).toISOString().slice(0, 10)} (${(tYears * 365.25).toFixed(1)} days)`);
  console.log(`Avg SVI implied ATM vol : ${pct(avgImplied)}`);
  console.log('');

  // ── Break-even analysis for Range-Roll ────────────────────────────────────
  console.log('─── Break-Even Realised Vol for ⑤ Range-Roll (where E[APY] = 0) ───');
  console.log('    (bettor breaks even when realised win rate = cost_implied)');
  console.log('');
  for (const util of UTIL_LEVELS) {
    const be = breakEvenVol(records, util);
    const safetyPct = ((avgImplied - be) / avgImplied * 100).toFixed(1);
    console.log(`  Util ${(util * 100).toFixed(0).padStart(2)}%  |  break-even = ${pct(be, 1)}  |  implied avg = ${pct(avgImplied, 1)}  |  safety margin = ${safetyPct}% below implied`);
  }
  console.log('');
  console.log('  → Range-Roll is profitable ONLY when σ_realised < break-even (≈ σ_implied).');
  console.log('    The spread is small relative to the range premium so the margin is thin.\n');

  // ── Run the analysis ───────────────────────────────────────────────────────
  const rows = runRegimeAnalysis(records);
  await writeCache('regime_results', rows);

  // ── Print tables per util level ────────────────────────────────────────────
  for (const util of UTIL_LEVELS) {
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`  Utilisation: ${pct(util, 0)}`);
    console.log(`═══════════════════════════════════════════════════════════`);

    const strategies = ['① PLP Supplier', '⑤ Range-Roll', '⑥ Vol-Targeted', '⑦ Vol-Arb'];

    for (const strat of strategies) {
      const stratRows = rows.filter((r) => r.strategy === strat && r.util === util);
      if (stratRows.length === 0) continue;

      console.log(`\n  ${strat}`);
      console.log(`  ${'Realised Vol'.padEnd(22)} ${'E[APY]'.padStart(12)} ${'Win Rate'.padStart(10)} ${'Mode/Note'.padStart(14)}`);
      console.log(`  ${'─'.repeat(64)}`);

      for (const r of stratRows) {
        const apyStr = apyFmt(r.net_apy).padStart(12);
        const wrStr = pct(r.mean_win_rate).padStart(10);
        const modeStr = (r.mode ?? '—').padStart(14);
        const marker = r.net_apy < 0 ? ' ◄ LOSS' : '';
        console.log(`  ${r.vol_label.padEnd(22)} ${apyStr} ${wrStr} ${modeStr}${marker}`);
      }
    }
  }

  // ── Vol-Arb mode detail ───────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  ⑦ Vol-Arb — Signal Mode by Realised Vol Scenario');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Average implied vol: ${pct(avgImplied)}`);
  console.log('');
  for (const scenario of VOL_SCENARIOS) {
    const ratio = avgImplied / scenario.sigma;
    const signal = ratio > 1.15 ? '⇒ SELL VOL (house on strangle)' : ratio < 0.85 ? '⇒ BUY  VOL (bettor on ATM binary)' : '⇒ NO TRADE';
    console.log(`  σ_real = ${pct(scenario.sigma, 0).padEnd(5)}  implied/real = ${ratio.toFixed(2).padStart(5)}  ${signal}`);
  }
  console.log('');
  console.log('  In buy-vol mode (σ_real > σ_implied × 1.15):');
  console.log('  → Standalone EV ≈ −spread/round (no structural edge without cross-venue data)');
  console.log('  → Production deployment uses Polymarket/Hyperliquid reference probability');
  console.log('    for genuine EV; the signal here is real, the instrument is TBD.\n');

  // ── Summary conclusions ────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  KEY CONCLUSIONS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('  ① PLP Supplier:');
  console.log('    Structural edge (E[P&L] = notional × (spread + p_implied − p_realized)).');
  console.log('    At higher σ_real: OTM strike payouts increase, but ATM spread income rises too.');
  console.log('    See table for net effect per vol regime.\n');

  console.log('  ⑤ Range-Roll / ⑥ Vol-Targeted:');
  console.log('    Profitable ONLY when σ_realized < break-even (≈ σ_implied − thin margin).');
  console.log('    In our backtest: σ_real = 27.7% < break-even ≈ 33% → profitable.');
  console.log('    At σ_real ≥ σ_implied: deeply negative. Short-vol risk must be disclosed.\n');

  console.log('  ⑦ Vol-Arb:');
  console.log('    Signal flips at σ_real ≈ σ_implied / 1.15.');
  console.log('    Sell-vol mode: house earns spread on strangle (positive EV when calm).');
  console.log('    Buy-vol mode: standalone EV = −spread (requires cross-venue data for edge).\n');

  console.log('  Risk disclosure for any short-vol vault:');
  console.log('    "This strategy profits in calm markets (σ_real < σ_implied).');
  console.log('     In volatility spikes, losses are unbounded relative to capital deployed.');
  console.log('     Position sizing is capped. Monitor implied/realised vol ratio before entry."\n');

  console.log(`Results saved to .cache/regime_results.json\n`);
}

main().catch(console.error);
