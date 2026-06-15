/**
 * GET /portfolios         — list portfolios for a wallet
 * GET /portfolios/:id     — single portfolio with cycle history
 * PATCH /portfolios/:id   — update bot config (pause/resume, drawdown settings, etc.)
 *
 * These endpoints are what the UI calls for the "My Bots" dashboard.
 * All BigInts serialized as strings for JSON transport.
 */

import { Router } from 'express';
import { z } from 'zod';
import { getPrismaClient } from '@sonarkk/core';

export const portfolioRouter = Router();

const ListQuerySchema = z.object({
  wallet: z.string().min(1, 'wallet address required'),
  active: z.enum(['true', 'false', 'all']).default('all'),
});

const PatchBodySchema = z.object({
  // Pause / resume
  is_paused:                  z.boolean().optional(),
  pause_reason:               z.string().max(200).optional(),
  // Config overrides
  util_target:                z.number().min(0.01).max(1.0).optional(),
  vol_target_bps:             z.number().int().min(500).max(10000).nullable().optional(),
  min_atm_vol_override:       z.number().min(0.10).nullable().optional(),
  strike_selection:           z.enum(['ATM', 'OTM_1', 'OTM_2']).optional(),
  liquidity_reserve_pct:      z.number().min(0).max(0.95).optional(),
  drawdown_pause_threshold_pct: z.number().min(0.01).max(0.99).nullable().optional(),
  // Stop-loss in human-readable DUSDC (converted to raw internally)
  stop_loss_dusdc:            z.number().positive().nullable().optional(),
  hedge_multiplier:           z.number().min(0.1).max(2.0).optional(),
}).strict();

function bigintToStr(v: bigint | null | undefined): string | null {
  return v != null ? v.toString() : null;
}

// ── GET /portfolios ────────────────────────────────────────────────────────────

portfolioRouter.get('/', async (req, res) => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }

  const { wallet, active } = parsed.data;
  const isActiveFilter =
    active === 'true' ? true : active === 'false' ? false : undefined;

  try {
    const prisma = getPrismaClient();
    const portfolios = await prisma.portfolio.findMany({
      where: { ownerAddress: wallet, ...(isActiveFilter !== undefined ? { isActive: isActiveFilter } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        vaultConfig: { select: { id: true, name: true, isPublic: true } },
        cycles: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { navPerShareAfter: true, totalNavRaw: true, createdAt: true, status: true },
        },
      },
    });

    res.json({
      portfolios: portfolios.map(p => ({
        id:                p.id,
        object_id:         p.objectId,
        strategy:          p.strategy,
        is_active:         p.isActive,
        is_paused:         p.isPaused,
        pause_reason:      p.pauseReason,
        vault_config:      p.vaultConfig,
        util_target:       p.utilTarget,
        strike_selection:  p.strikeSelection,
        liquidity_reserve: p.liquidityReservePct,
        drawdown_pause:    p.drawdownPauseThresholdPct,
        stop_loss_raw:     bigintToStr(p.stopLossFloorRaw),
        peak_nav_raw:      bigintToStr(p.peakNavPerShareRaw),
        latest_nav_raw:    bigintToStr(p.cycles[0]?.navPerShareAfter ?? null),
        latest_total_nav:  bigintToStr(p.cycles[0]?.totalNavRaw ?? null),
        last_cycle_at:     p.cycles[0]?.createdAt?.toISOString() ?? null,
        last_cycle_status: p.cycles[0]?.status ?? null,
        created_at:        p.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /portfolios/:id ────────────────────────────────────────────────────────

portfolioRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const prisma = getPrismaClient();
    const p = await prisma.portfolio.findFirst({
      where: { OR: [{ id }, { objectId: id }] },
      include: {
        vaultConfig: true,
        cycles: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            oracleId: true,
            expiryMs: true,
            status: true,
            skipReason: true,
            navPerShareBefore: true,
            navPerShareAfter: true,
            totalNavRaw: true,
            atmVol: true,
            atmSpread: true,
            entryGuardSkipped: true,
            supplyTxDigest: true,
            settleTxDigest: true,
            hedgeDirection: true,
            coverageRatioPct: true,
            volArbFired: true,
            volArbEdgePct: true,
            createdAt: true,
          },
        },
      },
    });

    if (!p) { res.status(404).json({ error: 'Portfolio not found' }); return; }

    res.json({
      id:                p.id,
      object_id:         p.objectId,
      owner:             p.ownerAddress,
      policy_cap_id:     p.policyCapId,
      strategy:          p.strategy,
      is_active:         p.isActive,
      is_paused:         p.isPaused,
      pause_reason:      p.pauseReason,
      hedge_multiplier:  p.hedgeMultiplier,
      manager_id:        p.managerId,
      vault_config:      p.vaultConfig,
      config: {
        util_target:            p.utilTarget,
        vol_target_bps:         p.volTargetBps,
        min_atm_vol_override:   p.minAtmVolOverride,
        strike_selection:       p.strikeSelection,
        liquidity_reserve_pct:  p.liquidityReservePct,
        drawdown_pause_pct:     p.drawdownPauseThresholdPct,
        stop_loss_floor_raw:    bigintToStr(p.stopLossFloorRaw),
        peak_nav_per_share_raw: bigintToStr(p.peakNavPerShareRaw),
      },
      cycles: p.cycles.map(c => ({
        id:                   c.id,
        oracle_id:            c.oracleId,
        expiry_ms:            c.expiryMs.toString(),
        status:               c.status,
        skip_reason:          c.skipReason,
        nav_per_share_before: bigintToStr(c.navPerShareBefore),
        nav_per_share_after:  bigintToStr(c.navPerShareAfter),
        total_nav_raw:        bigintToStr(c.totalNavRaw),
        atm_vol:              c.atmVol,
        atm_spread:           c.atmSpread,
        entry_guard_skipped:  c.entryGuardSkipped,
        supply_tx:            c.supplyTxDigest,
        settle_tx:            c.settleTxDigest,
        hedge_direction:      c.hedgeDirection,
        coverage_ratio_pct:   c.coverageRatioPct,
        vol_arb_fired:        c.volArbFired,
        vol_arb_edge_pct:     c.volArbEdgePct,
        created_at:           c.createdAt.toISOString(),
      })),
      created_at: p.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── PATCH /portfolios/:id ─────────────────────────────────────────────────────

portfolioRouter.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const parsed = PatchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  const body = parsed.data;
  try {
    const prisma = getPrismaClient();
    const existing = await prisma.portfolio.findFirst({ where: { OR: [{ id }, { objectId: id }] } });
    if (!existing) { res.status(404).json({ error: 'Portfolio not found' }); return; }

    const stopLossRaw = body.stop_loss_dusdc !== undefined
      ? (body.stop_loss_dusdc != null ? BigInt(Math.round(body.stop_loss_dusdc * 1e6)) : null)
      : undefined;

    const updated = await prisma.portfolio.update({
      where: { id: existing.id },
      data: {
        ...(body.is_paused     !== undefined ? { isPaused: body.is_paused } : {}),
        ...(body.pause_reason  !== undefined ? { pauseReason: body.pause_reason } : {}),
        ...(body.util_target   !== undefined ? { utilTarget: body.util_target } : {}),
        ...(body.vol_target_bps !== undefined ? { volTargetBps: body.vol_target_bps } : {}),
        ...(body.min_atm_vol_override !== undefined ? { minAtmVolOverride: body.min_atm_vol_override } : {}),
        ...(body.strike_selection !== undefined ? { strikeSelection: body.strike_selection } : {}),
        ...(body.liquidity_reserve_pct !== undefined ? { liquidityReservePct: body.liquidity_reserve_pct } : {}),
        ...(body.drawdown_pause_threshold_pct !== undefined ? { drawdownPauseThresholdPct: body.drawdown_pause_threshold_pct } : {}),
        ...(stopLossRaw !== undefined ? { stopLossFloorRaw: stopLossRaw } : {}),
        ...(body.hedge_multiplier !== undefined ? { hedgeMultiplier: body.hedge_multiplier } : {}),
      },
    });

    res.json({ updated: true, id: updated.id, object_id: updated.objectId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
