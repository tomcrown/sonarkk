/**
 * context-assembler.ts — Gathers live state for the AI copilot system prompt.
 *
 * Pulls from three sources:
 *   1. predict-server  — active oracle SVI → ATM vol + spread + expiry + BTC spot
 *   2. DB (Prisma)     — portfolio state, recent cycles, vault leaderboard
 *   3. Derived         — market regime classification
 *
 * Called once per chat request; cached per wallet/portfolio for 30 seconds.
 */

import { getPrismaClient, computeSpread, atmVol as computeAtmVol, binaryCallProb, predictClient } from '@sonarkk/core';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MarketContext {
  atm_vol: number;
  regime: 'calm' | 'normal' | 'high_vol';
  spread_at_atm: number;
  active_oracle_count: number;
  expiry_in_minutes: number | null;
  btc_price_usd: number | null;
}

export interface PortfolioContext {
  object_id: string;
  strategy: string;
  is_active: boolean;
  is_paused: boolean;
  pause_reason: string | null;
  nav_per_share_now: bigint | null;
  nav_per_share_before: bigint | null;
  total_cycles: number;
  util_target: number;
  strike_selection: string;
  liquidity_reserve_pct: number;
  drawdown_pause_pct: number | null;
  stop_loss_raw: bigint | null;
}

export interface LeaderboardEntry {
  vault_config_id: string;
  name: string;
  strategy: string;
  combined_tvl_raw: bigint | null;
  cycle_count: number;
  rank: number;
}

export interface LiveContext {
  market: MarketContext | null;
  portfolios: PortfolioContext[];
  leaderboard: LeaderboardEntry[];
  assembled_at: number;
}

// ── Cache ──────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, LiveContext>();

// ── Market context ─────────────────────────────────────────────────────────────

async function buildMarketContext(): Promise<MarketContext | null> {
  // Single call to get all active oracles — reused for count + picking best oracle.
  let activeOracles: Awaited<ReturnType<typeof predictClient.oracles>>;
  try {
    activeOracles = await predictClient.oracles({ status: 'active' });
  } catch {
    return null;
  }

  if (activeOracles.length === 0) return null;

  // Pick the oracle expiring soonest (most relevant for current market state).
  const oracle = activeOracles.sort((a, b) => a.expiry - b.expiry)[0]!;

  // Fetch SVI params and spot price for that oracle in parallel.
  const [sviResult, priceResult] = await Promise.allSettled([
    predictClient.oracleSvi(oracle.oracle_id, { limit: 1 }),
    predictClient.oraclePrices(oracle.oracle_id, { limit: 1 }),
  ]);

  const sviRows = sviResult.status === 'fulfilled' ? sviResult.value : [];
  const priceRows = priceResult.status === 'fulfilled' ? priceResult.value : [];

  const svi = sviRows[0];
  if (!svi) return null;

  const btcPriceUsd = priceRows[0] != null ? priceRows[0].spot / 1e9 : null;

  const tYears = Math.max((oracle.expiry - Date.now()) / (365.25 * 24 * 3_600_000), 0);
  const SVI_SCALE = 1e9;
  const sviParams = {
    a:     svi.a     / SVI_SCALE,
    b:     svi.b     / SVI_SCALE,
    rho:   (svi.rho_negative ? -1 : 1) * (svi.rho   / SVI_SCALE),
    m:     (svi.m_negative   ? -1 : 1) * (svi.m     / SVI_SCALE),
    sigma: svi.sigma / SVI_SCALE,
  };

  const atm = computeAtmVol(sviParams, tYears);
  const p_atm = binaryCallProb(sviParams, 0);
  const spread = computeSpread(p_atm, 0.3); // assume 30% utilization for context

  const regime: MarketContext['regime'] =
    atm < 0.25 ? 'calm' :
    atm < 0.50 ? 'normal' : 'high_vol';

  const expiryInMin = oracle.expiry > Date.now()
    ? (oracle.expiry - Date.now()) / 60_000
    : null;

  return {
    atm_vol: atm,
    regime,
    spread_at_atm: spread,
    active_oracle_count: activeOracles.length,
    expiry_in_minutes: expiryInMin,
    btc_price_usd: btcPriceUsd,
  };
}

// ── Portfolio context ──────────────────────────────────────────────────────────

async function buildPortfolioContext(
  walletAddress?: string,
  portfolioId?: string,
): Promise<PortfolioContext[]> {
  const prisma = getPrismaClient();

  const where = portfolioId
    ? { objectId: portfolioId }
    : walletAddress
    ? { ownerAddress: walletAddress }
    : null;

  if (!where) return [];

  const portfolios = await prisma.portfolio.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      cycles: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          status: true,
          navPerShareBefore: true,
          navPerShareAfter: true,
          createdAt: true,
        },
      },
    },
  });

  return portfolios.map(p => {
    const cycles = p.cycles as Array<{
      status: string;
      navPerShareBefore: bigint | null;
      navPerShareAfter: bigint | null;
      createdAt: Date;
    }>;
    const latestCycle = cycles[0];
    const oldestCycle = cycles[cycles.length - 1];

    return {
      object_id: p.objectId,
      strategy: p.strategy,
      is_active: p.isActive,
      is_paused: p.isPaused,
      pause_reason: p.pauseReason,
      nav_per_share_now: latestCycle?.navPerShareAfter ?? null,
      nav_per_share_before: oldestCycle?.navPerShareBefore ?? null,
      total_cycles: cycles.length,
      util_target: p.utilTarget,
      strike_selection: p.strikeSelection,
      liquidity_reserve_pct: p.liquidityReservePct,
      drawdown_pause_pct: p.drawdownPauseThresholdPct,
      stop_loss_raw: p.stopLossFloorRaw,
    };
  });
}

// ── Leaderboard context ────────────────────────────────────────────────────────

async function buildLeaderboardContext(): Promise<LeaderboardEntry[]> {
  const prisma = getPrismaClient();

  const entries = await prisma.vaultLeaderboardEntry.findMany({
    orderBy: { rank: 'asc' },
    take: 10,
    include: {
      vaultConfig: {
        select: { name: true, allocations: true },
      },
    },
  });

  return entries.map(e => {
    let strategy = 'MIXED';
    try {
      const alloc = JSON.parse(e.vaultConfig.allocations) as Array<{ strategy: string; allocationBps: number }>;
      if (alloc.length === 1 && alloc[0]) {
        strategy = alloc[0].strategy;
      }
    } catch { /* ignore */ }

    return {
      vault_config_id: e.vaultConfigId,
      name: e.vaultConfig.name,
      strategy,
      combined_tvl_raw: e.combinedTvlRaw,
      cycle_count: e.totalCycles,
      rank: e.rank,
    };
  });
}

// ── Main assembler ─────────────────────────────────────────────────────────────

export async function assembleContext(
  walletAddress?: string,
  portfolioId?: string,
): Promise<LiveContext> {
  const cacheKey = `${walletAddress ?? ''}:${portfolioId ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.assembled_at < CACHE_TTL_MS) {
    return cached;
  }

  const [market, portfolios, leaderboard] = await Promise.allSettled([
    buildMarketContext(),
    buildPortfolioContext(walletAddress, portfolioId),
    buildLeaderboardContext(),
  ]);

  const ctx: LiveContext = {
    market: market.status === 'fulfilled' ? market.value : null,
    portfolios: portfolios.status === 'fulfilled' ? portfolios.value : [],
    leaderboard: leaderboard.status === 'fulfilled' ? leaderboard.value : [],
    assembled_at: Date.now(),
  };

  cache.set(cacheKey, ctx);
  return ctx;
}
