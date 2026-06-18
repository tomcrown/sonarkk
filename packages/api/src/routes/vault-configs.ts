/**
 * POST /vault-configs          — create a named bot (VaultConfig) wrapping deployed portfolios
 * GET  /vault-configs/:id      — fetch config + per-strategy params (for copy flow)
 * POST /vault-configs/:id/copy — record a copy: create follower VaultConfig + VaultCopyRelation
 */

import { Router } from 'express';
import { z } from 'zod';
import { getPrismaClient } from '@sonarkk/core';

export const vaultConfigRouter = Router();

const STRATEGY_TO_NUM: Record<string, number> = {
  PLP_SUPPLIER: 0, HEDGED_PLP: 1, SMART_VAULT: 2, PRINCIPAL_PROTECTED: 3,
  RANGE_ROLL: 4, VOL_TARGETED_RANGE: 5, CROSS_VENUE_ARB: 6, MARGIN_LOOP: 7,
};

const AllocationSpecSchema = z.object({
  strategy: z.string().min(1),
  allocationBps: z.number().int().min(1).max(10000),
});

const CreateBodySchema = z.object({
  name: z.string().min(1).max(80),
  creator_address: z.string().min(60),
  portfolio_ids: z.array(z.string().min(60)).min(1).max(4),
  allocations: z.array(AllocationSpecSchema).min(1).max(4),
  is_public: z.boolean().default(true),
  copy_fee_raw: z.string().regex(/^\d+$/).optional(),
});

const CopyBodySchema = z.object({
  follower_address: z.string().min(60),
  portfolio_ids: z.array(z.string().min(60)).min(1).max(4),
});

// ── POST /vault-configs ───────────────────────────────────────────────────────

vaultConfigRouter.post('/', async (req, res) => {
  const parsed = CreateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;

  if (d.portfolio_ids.length !== d.allocations.length) {
    res.status(400).json({ error: 'portfolio_ids and allocations must have the same length' });
    return;
  }
  const totalBps = d.allocations.reduce((s, a) => s + a.allocationBps, 0);
  if (totalBps !== 10000) {
    res.status(400).json({ error: `Allocations must sum to 10000 bps (100%), got ${totalBps}` });
    return;
  }

  try {
    const prisma = getPrismaClient();
    const vc = await prisma.vaultConfig.create({
      data: {
        name: d.name,
        creatorAddress: d.creator_address,
        allocations: JSON.stringify(d.allocations),
        isPublic: d.is_public,
        copyFeeRaw: d.copy_fee_raw ? BigInt(d.copy_fee_raw) : null,
      },
    });
    // Link each portfolio to this VaultConfig
    await prisma.portfolio.updateMany({
      where: { objectId: { in: d.portfolio_ids } },
      data: { vaultConfigId: vc.id },
    });
    // Seed a zero-TVL leaderboard entry so the bot appears immediately
    await prisma.vaultLeaderboardEntry.upsert({
      where: { vaultConfigId: vc.id },
      update: {},
      create: {
        vaultConfigId: vc.id,
        rank: 99,
        combinedTvlRaw: 0n,
        totalCycles: 0,
        successfulCycles: 0,
        copierCount: 0,
      },
    });
    res.status(201).json({ vault_config_id: vc.id, name: vc.name });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /vault-configs/:id ────────────────────────────────────────────────────

vaultConfigRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const prisma = getPrismaClient();
    const vc = await prisma.vaultConfig.findUnique({
      where: { id, isActive: true },
      include: {
        portfolios: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!vc) { res.status(404).json({ error: 'VaultConfig not found' }); return; }

    const allocations = JSON.parse(vc.allocations) as Array<{ strategy: string; allocationBps: number }>;

    // Enrich each allocation slot with the corresponding portfolio's live config
    const enriched = allocations.map((a, i) => {
      const p = vc.portfolios[i];
      return {
        strategy: a.strategy,
        strategyType: STRATEGY_TO_NUM[a.strategy] ?? 0,
        allocationBps: a.allocationBps,
        utilTarget: p?.utilTarget ?? 0.25,
        strikeSelection: p?.strikeSelection ?? 'ATM',
        liquidityReservePct: p?.liquidityReservePct ?? 0.10,
        drawdownPauseThresholdPct: p?.drawdownPauseThresholdPct ?? null,
        volTargetBps: p?.volTargetBps ?? null,
        hedgeMultiplier: p?.hedgeMultiplier ?? 1.0,
      };
    });

    res.json({
      id: vc.id,
      name: vc.name,
      creatorAddress: vc.creatorAddress,
      isPublic: vc.isPublic,
      copyFeeRaw: vc.copyFeeRaw?.toString() ?? null,
      sealBlobId: vc.sealBlobId ?? null,
      portfolioObjectIds: vc.portfolios.map(p => p.objectId),
      allocations: enriched,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── PATCH /vault-configs/:id ──────────────────────────────────────────────────

const PatchVaultConfigSchema = z.object({
  seal_blob_id: z.string().min(1).optional(),
  copy_fee_raw: z.string().regex(/^\d+$/).optional(),
  is_public:    z.boolean().optional(),
}).strict();

vaultConfigRouter.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const parsed = PatchVaultConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  try {
    const prisma = getPrismaClient();
    const existing = await prisma.vaultConfig.findUnique({ where: { id, isActive: true } });
    if (!existing) { res.status(404).json({ error: 'VaultConfig not found' }); return; }
    const updated = await prisma.vaultConfig.update({
      where: { id },
      data: {
        ...(body.seal_blob_id !== undefined ? { sealBlobId: body.seal_blob_id } : {}),
        ...(body.copy_fee_raw !== undefined ? { copyFeeRaw: BigInt(body.copy_fee_raw) } : {}),
        ...(body.is_public    !== undefined ? { isPublic: body.is_public } : {}),
      },
    });
    res.json({ updated: true, id: updated.id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /vault-configs/:id/copy ─────────────────────────────────────────────

vaultConfigRouter.post('/:id/copy', async (req, res) => {
  const { id: originalVaultId } = req.params;
  const parsed = CopyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const { follower_address, portfolio_ids } = parsed.data;

  try {
    const prisma = getPrismaClient();
    const original = await prisma.vaultConfig.findUnique({
      where: { id: originalVaultId, isPublic: true, isActive: true },
    });
    if (!original) {
      res.status(404).json({ error: 'VaultConfig not found or not public' });
      return;
    }

    const allocations = JSON.parse(original.allocations) as Array<{ strategy: string; allocationBps: number }>;
    if (portfolio_ids.length !== allocations.length) {
      res.status(400).json({
        error: `portfolio_ids count (${portfolio_ids.length}) must match allocation count (${allocations.length})`,
      });
      return;
    }

    // Create a VaultConfig for the follower
    const copied = await prisma.vaultConfig.create({
      data: {
        name: `${original.name} (copy)`,
        creatorAddress: follower_address,
        allocations: original.allocations,
        isPublic: false,
      },
    });

    // Link the follower's new portfolios to their VaultConfig
    await prisma.portfolio.updateMany({
      where: { objectId: { in: portfolio_ids } },
      data: { vaultConfigId: copied.id },
    });

    // Record the copy relationship (upsert to handle duplicate attempts)
    await prisma.vaultCopyRelation.upsert({
      where: { followerAddr_originalVaultId: { followerAddr: follower_address, originalVaultId } },
      update: { copiedVaultId: copied.id, isActive: true, allocationSnapshot: original.allocations },
      create: {
        followerAddr: follower_address,
        originalVaultId,
        copiedVaultId: copied.id,
        allocationSnapshot: original.allocations,
      },
    });

    // Increment the leaderboard copier count for the original vault
    await prisma.vaultLeaderboardEntry.updateMany({
      where: { vaultConfigId: originalVaultId },
      data: { copierCount: { increment: 1 } },
    });

    res.status(201).json({ vault_config_id: copied.id, name: copied.name });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
