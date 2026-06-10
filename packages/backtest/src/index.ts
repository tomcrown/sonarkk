/**
 * Backtest entry point.
 * Run: cd packages/backtest && npx tsx src/index.ts
 *
 * Output: prints full results table + writes results.json to .cache/
 */
import { runBacktest } from './runner.js';
import { writeCache } from './data/cache.js';
import { calibrateSvi } from './engine/svi.js';
import type { StrategyResult } from './data/types.js';

function formatTable(strategies: StrategyResult[]): void {
  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log('  Strategy Results Summary');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log(
    `  ${'Strategy'.padEnd(35)} ${'Util'.padEnd(5)} ${'APY%'.padEnd(8)} ${'MaxDD%'.padEnd(7)} ${'Sharpe'.padEnd(7)} ${'WinRate'.padEnd(8)} ${'Verdict'}`,
  );
  console.log('  ' + '─'.repeat(76));

  // Group by strategy ID (show all util levels).
  const grouped = new Map<string, StrategyResult[]>();
  for (const s of strategies) {
    const base = s.strategy_id.replace(/_util\d+$/, '');
    if (!grouped.has(base)) grouped.set(base, []);
    grouped.get(base)!.push(s);
  }

  for (const [, group] of grouped) {
    for (const s of group) {
      const apy = (s.net_apy * 100).toFixed(1).padStart(7);
      const dd = (s.max_drawdown * 100).toFixed(1).padStart(6);
      const sh = s.sharpe.toFixed(2).padStart(6);
      const wr = s.win_rate !== null ? (s.win_rate * 100).toFixed(1).padStart(6) + '%' : '    n/a';
      const util = (s.utilization * 100).toFixed(0).padStart(3) + '%';
      const verd = s.verdict === 'keep' ? '✓ keep' : s.verdict === 'fix' ? '~ fix' : '✗ cut';
      const nameShort = s.strategy_name.slice(0, 35).padEnd(35);
      console.log(`  ${nameShort} ${util}  ${apy}%  ${dd}%  ${sh}  ${wr}  ${verd}`);
    }
    console.log('  ' + '─'.repeat(76));
  }
}

async function main(): Promise<void> {
  try {
    const output = await runBacktest();
    formatTable(output.strategies);

    console.log('\n── Summary ────────────────────────────────────────────────────────────────');
    console.log(`  Oracles analysed:      ${output.oracle_count}`);
    console.log(`  Period:                ${output.period_start} → ${output.period_end}`);
    console.log(`  Realized BTC vol (ann): ${(output.realized_btc_vol * 100).toFixed(1)}%`);

    const keeps = output.strategies.filter((s) => s.verdict === 'keep').length;
    const fixes = output.strategies.filter((s) => s.verdict === 'fix').length;
    const cuts = output.strategies.filter((s) => s.verdict === 'cut').length;
    console.log(`  Verdicts:              ${keeps} keep  ${fixes} fix  ${cuts} cut`);
    console.log('──────────────────────────────────────────────────────────────────────────\n');

    await writeCache('results', output);
    console.log('  Results saved to packages/backtest/.cache/results.json');
  } catch (err) {
    console.error('Backtest failed:', err);
    process.exit(1);
  }
}

main();
