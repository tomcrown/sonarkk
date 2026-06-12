/**
 * Leaderboard backend job — Phase 5 Task 2.
 *
 * Aggregates KeeperCycle history per strategy type and upserts LeaderboardEntry records.
 * Ranking key: totalReturnPct descending.
 *
 * Mandatory APY caveat on every response:
 * "annualised from live testnet; trader volume is limited — not indicative of mainnet returns"
 *
 * Run: pnpm --filter @sonarkk/keeper tsx src/jobs/leaderboard.ts
 * Or import { runLeaderboardJob } and call periodically from the keeper.
 */

import { getPrismaClient } from '@sonarkk/core';
import { log } from '../logger.js';

export const APY_CAVEAT =
  'annualised from live testnet; trader volume is limited — not indicative of mainnet returns';

// Strategy type → human-readable name + slug
const STRATEGY_META: Record<string, { name: string; slug: string }> = {
  PLP_SUPPLIER:        { name: 'PLP Supplier',              slug: 'plp-supplier' },
  HEDGED_PLP:          { name: 'Hedged PLP',                slug: 'hedged-plp' },
  SMART_VAULT:         { name: 'Smart Vault (Index)',        slug: 'smart-vault' },
  PRINCIPAL_PROTECTED: { name: 'Principal Protected',       slug: 'principal-protected' },
  RANGE_ROLL:          { name: 'Range Roll',                 slug: 'range-roll' },
  VOL_TARGETED_RANGE:  { name: 'Vol-Targeted Range',        slug: 'vol-targeted-range' },
  CROSS_VENUE_ARB:     { name: 'Cross-Venue Vol-Arb (Sell)', slug: 'vol-arb-sell' },
};

export interface LeaderboardRow {
  rank: number;
  strategyType: string;
  strategyName: string;
  tvlDusdc: string;           // BigInt as string (human-readable DUSDC)
  totalReturnPct: number | null;
  rollingApyPct: number | null;
  apyCaveat: string;
  totalCycles: number;
  successfulCycles: number;
  skippedCycles: number;
  maxDrawdownPct: number | null;
  avgCoverageRatioPct: number | null;
  volArbCycleCount: number;
  volArbAvgEdgePct: number | null;
  copiers: number;
  updatedAt: Date;
}

// ── Internal stat helpers ─────────────────────────────────────────────────────

function computeMaxDrawdown(navSeries: bigint[]): number | null {
  if (navSeries.length < 2) return null;
  let peak = navSeries[0]!;
  let maxDD = 0;
  for (const nav of navSeries) {
    if (nav > peak) peak = nav;
    if (peak > 0n) {
      const dd = Number(peak - nav) / Number(peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

function annualizeReturn(totalReturnPct: number, periodDays: number): number | null {
  if (periodDays <= 0) return null;
  // Simple annualization: (1 + r)^(365/days) - 1
  const r = totalReturnPct / 100;
  return ((Math.pow(1 + r, 365 / periodDays) - 1) * 100);
}

function mean(values: number[]): number | null {
  const valid = values.filter(v => isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// ── Strategy record ensurer ───────────────────────────────────────────────────

export async function ensureStrategy(strategyType: string): Promise<string> {
  const prisma = getPrismaClient();
  const meta = STRATEGY_META[strategyType] ?? {
    name: strategyType,
    slug: strategyType.toLowerCase().replace(/_/g, '-'),
  };

  const existing = await prisma.strategy.findUnique({ where: { slug: meta.slug } });
  if (existing) return existing.id;

  const created = await prisma.strategy.create({
    data: {
      slug: meta.slug,
      name: meta.name,
      type: strategyType,
      active: true,
    },
  });
  log.info({ strategyType, id: created.id }, 'auto-created Strategy record');
  return created.id;
}

// ── Core job ──────────────────────────────────────────────────────────────────

export async function runLeaderboardJob(): Promise<LeaderboardRow[]> {
  const prisma = getPrismaClient();
  log.info('leaderboard job started');

  // Find all distinct strategy types in active portfolios.
  const portfolios = await prisma.portfolio.findMany({ where: { isActive: true } });
  const strategyTypes = [...new Set(portfolios.map(p => p.strategy))];

  const rows: Array<{ strategyType: string; totalReturnPct: number | null; entry: LeaderboardRow }> = [];

  for (const strategyType of strategyTypes) {
    const portfolioIds = portfolios
      .filter(p => p.strategy === strategyType)
      .map(p => p.id);

    // Fetch all cycles for this strategy's portfolios.
    const cycles = await prisma.keeperCycle.findMany({
      where: { portfolioId: { in: portfolioIds } },
      orderBy: { createdAt: 'asc' },
    });

    if (cycles.length === 0) continue;

    // ── Cycle stats ────────────────────────────────────────────────────────
    const totalCycles = cycles.length;
    const successfulCycles = cycles.filter(c => c.status === 'done').length;
    const skippedCycles = cycles.filter(c => c.status === 'skipped').length;

    // NAV per share time-series (from done cycles with navPerShareAfter set).
    const navSeries = cycles
      .filter(c => c.navPerShareAfter !== null)
      .map(c => c.navPerShareAfter!);

    const firstNav = navSeries[0] ?? null;
    const lastNav  = navSeries[navSeries.length - 1] ?? null;

    let totalReturnPct: number | null = null;
    if (firstNav !== null && lastNav !== null && firstNav > 0n) {
      totalReturnPct = Number(lastNav - firstNav) / Number(firstNav) * 100;
    }

    // Period in days from first to last cycle.
    const firstCycleDate = cycles[0]!.createdAt;
    const lastCycleDate  = cycles[cycles.length - 1]!.createdAt;
    const periodMs = lastCycleDate.getTime() - firstCycleDate.getTime();
    const periodDays = periodMs / (1000 * 60 * 60 * 24);
    const rollingApyPct = totalReturnPct !== null ? annualizeReturn(totalReturnPct, periodDays) : null;

    const maxDrawdownPct = computeMaxDrawdown(navSeries);

    // Coverage ratio — hedge efficiency (Hedged-PLP only, but computed for all).
    const coverageValues = cycles
      .filter(c => c.coverageRatioPct !== null)
      .map(c => c.coverageRatioPct!);
    const avgCoverageRatioPct = mean(coverageValues);

    // Vol-arb stats.
    const volArbCycles = cycles.filter(c => c.volArbFired);
    const volArbCycleCount = volArbCycles.length;
    const volArbEdgePcts = volArbCycles
      .filter(c => c.volArbEdgePct !== null)
      .map(c => c.volArbEdgePct!);
    const volArbAvgEdgePct = mean(volArbEdgePcts);

    // TVL: latest totalNavRaw across portfolios for this strategy.
    const latestNavRaw = [...cycles].reverse().find(c => c.totalNavRaw !== null)?.totalNavRaw ?? 0n;

    // Copiers: active CopyRelations referencing any portfolio of this strategy.
    const strategyId = await ensureStrategy(strategyType);
    const copiersCount = await prisma.copyRelation.count({
      where: { strategyId, isActive: true },
    });

    const entry: LeaderboardRow = {
      rank: 0, // assigned after sort
      strategyType,
      strategyName: STRATEGY_META[strategyType]?.name ?? strategyType,
      tvlDusdc: (Number(latestNavRaw) / 1e6).toFixed(6),
      totalReturnPct,
      rollingApyPct,
      apyCaveat: APY_CAVEAT,
      totalCycles,
      successfulCycles,
      skippedCycles,
      maxDrawdownPct,
      avgCoverageRatioPct,
      volArbCycleCount,
      volArbAvgEdgePct,
      copiers: copiersCount,
      updatedAt: new Date(),
    };

    rows.push({ strategyType, totalReturnPct, entry });

    // Upsert LeaderboardEntry in DB.
    await prisma.leaderboardEntry.upsert({
      where: { strategyId },
      create: {
        strategyId,
        rank: 0,
        tvlDusdc: latestNavRaw,
        totalReturnPct,
        rollingApyPct,
        apyCaveat: APY_CAVEAT,
        totalCycles,
        successfulCycles,
        skippedCycles,
        maxDrawdownPct,
        avgCoverageRatioPct,
        volArbCycleCount,
        volArbAvgEdgePct,
        copiers: copiersCount,
      },
      update: {
        tvlDusdc: latestNavRaw,
        totalReturnPct,
        rollingApyPct,
        apyCaveat: APY_CAVEAT,
        totalCycles,
        successfulCycles,
        skippedCycles,
        maxDrawdownPct,
        avgCoverageRatioPct,
        volArbCycleCount,
        volArbAvgEdgePct,
        copiers: copiersCount,
      },
    });
  }

  // Sort by totalReturnPct descending (nulls last), assign ranks.
  rows.sort((a, b) => {
    if (a.totalReturnPct === null && b.totalReturnPct === null) return 0;
    if (a.totalReturnPct === null) return 1;
    if (b.totalReturnPct === null) return -1;
    return b.totalReturnPct - a.totalReturnPct;
  });

  const rankedRows: LeaderboardRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    row.entry.rank = i + 1;
    rankedRows.push(row.entry);

    // Update rank in DB.
    const strategyId = await ensureStrategy(row.strategyType);
    await prisma.leaderboardEntry.update({
      where: { strategyId },
      data: { rank: i + 1 },
    });
  }

  log.info({ count: rankedRows.length }, 'leaderboard job complete');
  return rankedRows;
}

// ── Standalone runner ─────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  runLeaderboardJob()
    .then(rows => {
      console.log('\n=== LEADERBOARD ===');
      for (const row of rows) {
        console.log(`  #${row.rank} ${row.strategyName}`);
        console.log(`     TVL: ${row.tvlDusdc} DUSDC`);
        console.log(`     Return: ${row.totalReturnPct?.toFixed(4) ?? 'n/a'}%`);
        console.log(`     APY: ${row.rollingApyPct?.toFixed(1) ?? 'n/a'}% ⚠ ${row.apyCaveat}`);
        console.log(`     Cycles: ${row.totalCycles} total / ${row.successfulCycles} done / ${row.skippedCycles} skipped`);
        if (row.avgCoverageRatioPct !== null)
          console.log(`     Avg hedge coverage: ${row.avgCoverageRatioPct.toFixed(1)}%`);
        if (row.volArbCycleCount > 0)
          console.log(`     Vol-arb: ${row.volArbCycleCount} cycles, avg edge ${row.volArbAvgEdgePct?.toFixed(2) ?? 'n/a'}%`);
        console.log(`     Copiers: ${row.copiers}`);
      }
    })
    .catch(err => { console.error(err); process.exit(1); });
}
