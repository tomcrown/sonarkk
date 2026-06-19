/**
 * GET /leaderboard — Vault leaderboard, frontend-ready JSON.
 *
 * Returns top vaults ranked by totalReturnPct with caveat annotations.
 * BigInts serialized as strings for JSON transport.
 *
 * Query params:
 *   limit  — max results (default 20, max 100)
 */

import { Router } from 'express';
import { z } from 'zod';
import { getPrismaClient } from '@sonarkk/core';

export const leaderboardRouter = Router();

const CAVEAT = 'APY modeled on assumed/synthetic trader flow — testnet has minimal live flow. Numbers are not indicative of mainnet returns.';

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

leaderboardRouter.get('/', async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() });
    return;
  }

  const { limit } = parsed.data;

  try {
    const prisma = getPrismaClient();
    const entries = await prisma.vaultLeaderboardEntry.findMany({
      orderBy: { rank: 'asc' },
      take: limit,
      include: {
        vaultConfig: {
          include: {
            portfolios: {
              where: { isActive: true },
              select: {
                totalDepositedRaw: true,
                _count: { select: { cycles: true } },
              },
            },
          },
        },
      },
    });

    const response = entries.map(e => {
      let allocations: unknown[] = [];
      try { allocations = JSON.parse(e.vaultConfig.allocations) as unknown[]; } catch { /* ignore */ }

      // Use job-computed TVL if available, otherwise fall back to sum of portfolio deposits
      const depositSum = e.vaultConfig.portfolios.reduce(
        (sum: bigint, p: { totalDepositedRaw: bigint }) => sum + p.totalDepositedRaw, 0n
      );
      const tvlRaw = (e.combinedTvlRaw != null && e.combinedTvlRaw > 0n)
        ? e.combinedTvlRaw
        : depositSum;

      // Use job-computed cycle count if available, otherwise sum from portfolios
      const portfolioCycleCount = e.vaultConfig.portfolios.reduce(
        (sum: number, p: { _count: { cycles: number } }) => sum + p._count.cycles, 0
      );
      const totalCycles = e.totalCycles > 0 ? e.totalCycles : portfolioCycleCount;

      return {
        rank:              e.rank,
        vault_config_id:   e.vaultConfigId,
        name:              e.vaultConfig.name,
        creator:           e.vaultConfig.creatorAddress,
        is_public:         e.vaultConfig.isPublic,
        seal_blob_id:      e.vaultConfig.sealBlobId ?? null,
        allocations,
        combined_tvl_dusdc: (Number(tvlRaw) / 1e6).toFixed(6),
        total_return_pct:  e.totalReturnPct,
        rolling_apy_pct:   e.rollingApyPct,
        apy_caveat:        e.rollingApyPct != null ? CAVEAT : null,
        total_cycles:      totalCycles,
        successful_cycles: e.successfulCycles,
        copier_count:      e.copierCount,
        created_at:        e.vaultConfig.createdAt.toISOString(),
        updated_at:        e.updatedAt.toISOString(),
      };
    });

    res.json({ entries: response, count: response.length, caveat: CAVEAT });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
