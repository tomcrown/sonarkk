/**
 * context-assembler.ts — Gathers live state for the AI copilot system prompt.
 *
 * Pulls from three sources:
 *   1. predict-server  — active oracle SVI → ATM vol + spread + expiry
 *   2. DB (Prisma)     — portfolio state, recent cycles, vault leaderboard
 *   3. Derived         — market regime classification
 *
 * Called once per chat request; cached per wallet/portfolio for 30 seconds.
 */

import { getPrismaClient, computeSpread, atmVol as computeAtmVol, binaryCallProb } from '@sonarkk/core';
import { env } from '../env.js';

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

// ── BTC price fetch ───────────────────────────────────────────────────────────

async function fetchBtcPrice(): Promise<number | null> {
  try {
    const resp = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      { signal: AbortSignal.timeout(3000) },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { price?: string };
    return data.price ? parseFloat(data.price) : null;
  } catch {
    return null;
  }
}

// ── Oracle fetch ───────────────────────────────────────────────────────────────

interface RawOracle {
  oracle_id: string;
  expiry: number;
  atm_vol: number;
  t_years: number;
  svi: { a: number; b: number; rho: number; m: number; sigma: number };
}

async function fetchActiveOracle(): Promise<RawOracle | null> {
  try {
    const url = `${env.PREDICT_SERVER_URL}/oracles/active`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { oracles?: RawOracle[] };
    if (!data.oracles || data.oracles.length === 0) return null;

    // Pick the oracle with the highest t_years (longest to expiry — most info).
    return data.oracles.sort((a, b) => b.t_years - a.t_years)[0] ?? null;
  } catch {
    return null;
  }
}

// ── Market context ─────────────────────────────────────────────────────────────

async function buildMarketContext(): Promise<MarketContext | null> {
  const [oracleResult, btcPriceResult] = await Promise.allSettled([
    fetchActiveOracle(),
    fetchBtcPrice(),
  ]);

  const oracle = oracleResult.status === 'fulfilled' ? oracleResult.value : null;
  if (!oracle) return null;

  const btcPriceUsd = btcPriceResult.status === 'fulfilled' ? btcPriceResult.value : null;

  const atm = oracle.atm_vol ?? computeAtmVol(oracle.svi, oracle.t_years);
  const p_atm = binaryCallProb(oracle.svi, 0);
  const spread = computeSpread(p_atm, 0.3); // assume 30% utilization for context

  const regime: MarketContext['regime'] =
    atm < 0.25 ? 'calm' :
    atm < 0.50 ? 'normal' : 'high_vol';

  const expiryMs = oracle.expiry;
  const expiryInMin = expiryMs > Date.now()
    ? (expiryMs - Date.now()) / 60_000
    : null;

  // Count active oracles from the same call.
  let activeCount = 1;
  try {
    const url = `${env.PREDICT_SERVER_URL}/oracles/active`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = (await resp.json()) as { oracles?: unknown[] };
      activeCount = data.oracles?.length ?? 1;
    }
  } catch { /* ignore */ }

  return {
    atm_vol: atm,
    regime,
    spread_at_atm: spread,
    active_oracle_count: activeCount,
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
