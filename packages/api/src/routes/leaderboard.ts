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
          select: {
            id: true,
            name: true,
            allocations: true,
            isPublic: true,
            creatorAddress: true,
            createdAt: true,
          },
        },
      },
    });

    const response = entries.map(e => {
      let allocations: unknown[] = [];
      try { allocations = JSON.parse(e.vaultConfig.allocations) as unknown[]; } catch { /* ignore */ }

      return {
        rank:              e.rank,
        vault_config_id:   e.vaultConfigId,
        name:              e.vaultConfig.name,
        creator:           e.vaultConfig.creatorAddress,
        is_public:         e.vaultConfig.isPublic,
        allocations,
        combined_tvl_dusdc: e.combinedTvlRaw != null ? (Number(e.combinedTvlRaw) / 1e6).toFixed(6) : null,
        total_return_pct:  e.totalReturnPct,
        rolling_apy_pct:   e.rollingApyPct,
        apy_caveat:        e.rollingApyPct != null ? CAVEAT : null,
        total_cycles:      e.totalCycles,
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
