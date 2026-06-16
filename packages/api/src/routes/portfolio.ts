/**
 * GET  /portfolios         — list portfolios for a wallet
 * GET  /portfolios/:id     — single portfolio with cycle history
 * PATCH /portfolios/:id    — update bot config (pause/resume, drawdown settings, etc.)
 * POST /portfolios         — register a newly deployed portfolio (called after on-chain deploy TX)
 */

import { Router } from 'express';
import { z } from 'zod';
import { getPrismaClient } from '@sonarkk/core';

export const portfolioRouter = Router();

// ── Strategy type mappings ────────────────────────────────────────────────────

const STRATEGY_TO_NUM: Record<string, number> = {
  PLP_SUPPLIER: 0,
  HEDGED_PLP: 1,
  SMART_VAULT: 2,
  PRINCIPAL_PROTECTED: 3,
  RANGE_ROLL: 4,
  VOL_TARGETED_RANGE: 5,
  CROSS_VENUE_ARB: 6,
  MARGIN_LOOP: 7,
}

const NUM_TO_STRATEGY: Record<number, string> = Object.fromEntries(
  Object.entries(STRATEGY_TO_NUM).map(([k, v]) => [v, k]),
)

const STRATEGY_DISPLAY: Record<string, string> = {
  PLP_SUPPLIER: 'PLP Supplier',
  HEDGED_PLP: 'Hedged PLP',
  SMART_VAULT: 'Smart Vault',
  PRINCIPAL_PROTECTED: 'Principal Protected',
  RANGE_ROLL: 'Range Roll',
  VOL_TARGETED_RANGE: 'Vol-Targeted Range',
  CROSS_VENUE_ARB: 'Cross-Venue Arb',
  MARGIN_LOOP: 'Margin Loop',
}

function b(v: bigint | null | undefined): string | null {
  return v != null ? v.toString() : null;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  wallet: z.string().min(1, 'wallet address required'),
  active: z.enum(['true', 'false', 'all']).default('all'),
});

const CreateBodySchema = z.object({
  object_id:      z.string().min(60, 'invalid object ID'),
  policy_cap_id:  z.string().min(60, 'invalid PolicyCap ID'),
  owner_address:  z.string().min(60, 'invalid owner address'),
  strategy_type:  z.number().int().min(0).max(7),
  name:           z.string().max(80).optional(),
  initial_deposit_raw: z.string().regex(/^\d+$/).optional(), // BigInt as string
  util_target:         z.number().min(0.01).max(1.0).default(0.25),
  strike_selection:    z.enum(['ATM', 'OTM_1', 'OTM_2']).default('ATM'),
  liquidity_reserve_pct:           z.number().min(0).max(0.95).default(0.10),
  drawdown_pause_threshold_pct:    z.number().min(0.01).max(0.99).nullable().optional(),
  vol_target_bps:                  z.number().int().min(500).max(10000).nullable().optional(),
  hedge_multiplier:                z.number().min(0.1).max(2.0).default(1.0),
});

const PatchBodySchema = z.object({
  is_paused:                    z.boolean().optional(),
  pause_reason:                 z.string().max(200).optional(),
  name:                         z.string().max(80).optional(),
  util_target:                  z.number().min(0.01).max(1.0).optional(),
  vol_target_bps:               z.number().int().min(500).max(10000).nullable().optional(),
  min_atm_vol_override:         z.number().min(0.10).nullable().optional(),
  strike_selection:             z.enum(['ATM', 'OTM_1', 'OTM_2']).optional(),
  liquidity_reserve_pct:        z.number().min(0).max(0.95).optional(),
  drawdown_pause_threshold_pct: z.number().min(0.01).max(0.99).nullable().optional(),
  stop_loss_dusdc:              z.number().positive().nullable().optional(),
  hedge_multiplier:             z.number().min(0.1).max(2.0).optional(),
}).strict();

// ── Shared serializers ────────────────────────────────────────────────────────

function serializeListItem(p: {
  id: string;
  name: string | null;
  strategy: string;
  objectId: string;
  isActive: boolean;
  isPaused: boolean;
  totalDepositedRaw: bigint;
  createdAt: Date;
  cycles: Array<{ navPerShareAfter: bigint | null; totalNavRaw: bigint | null; createdAt: Date; status: string }>;
}) {
  const strategyType = STRATEGY_TO_NUM[p.strategy] ?? 0;
  const latestCycle = p.cycles[0];
  return {
    id: p.id,
    name: p.name ?? STRATEGY_DISPLAY[p.strategy] ?? p.strategy,
    strategyType,
    vaultObjectId: p.objectId,
    navPerShareRaw: b(latestCycle?.navPerShareAfter) ?? '1000000000',
    totalDepositedRaw: b(p.totalDepositedRaw) ?? '0',
    isPaused: p.isPaused,
    cycleCount: p.cycles.length,
    createdAt: p.createdAt.toISOString(),
  };
}

function serializeCycle(c: {
  id: string;
  oracleId: string;
  expiryMs: bigint;
  status: string;
  skipReason: string | null;
  navPerShareBefore: bigint | null;
  navPerShareAfter: bigint | null;
  totalNavRaw: bigint | null;
  atmVol: number | null;
  atmSpread: number | null;
  entryGuardSkipped: boolean;
  supplyTxDigest: string | null;
  settleTxDigest: string | null;
  hedgeDirection: string | null;
  coverageRatioPct: number | null;
  volArbFired: boolean;
  volArbEdgePct: number | null;
  createdAt: Date;
}) {
  return {
    id: c.id,
    expiryMs: c.expiryMs.toString(),
    action: c.supplyTxDigest ? 'SUPPLY' : c.status === 'skipped' ? 'SKIP' : c.status.toUpperCase(),
    pnlRaw: null,
    atmVol: c.atmVol,
    txDigest: c.supplyTxDigest ?? c.settleTxDigest ?? null,
    status: c.status,
    errorMessage: c.skipReason ?? null,
    createdAt: c.createdAt.toISOString(),
  };
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
      where: {
        ownerAddress: wallet,
        ...(isActiveFilter !== undefined ? { isActive: isActiveFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        cycles: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            navPerShareAfter: true,
            totalNavRaw: true,
            createdAt: true,
            status: true,
          },
        },
      },
    });

    res.json(portfolios.map(serializeListItem));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /portfolios ───────────────────────────────────────────────────────────

portfolioRouter.post('/', async (req, res) => {
  const parsed = CreateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  const d = parsed.data;
  const strategy = NUM_TO_STRATEGY[d.strategy_type];
  if (!strategy) {
    res.status(400).json({ error: `Unknown strategy_type: ${d.strategy_type}` });
    return;
  }

  try {
    const prisma = getPrismaClient();

    // Idempotency: if the same objectId is already registered, return it.
    const existing = await prisma.portfolio.findUnique({ where: { objectId: d.object_id } });
    if (existing) {
      res.status(200).json({ id: existing.id, object_id: existing.objectId, already_existed: true });
      return;
    }

    const portfolio = await prisma.portfolio.create({
      data: {
        objectId:            d.object_id,
        policyCapId:         d.policy_cap_id,
        ownerAddress:        d.owner_address,
        strategy,
        name:                d.name ?? null,
        totalDepositedRaw:   d.initial_deposit_raw ? BigInt(d.initial_deposit_raw) : 0n,
        isActive:            true,
        utilTarget:          d.util_target,
        strikeSelection:     d.strike_selection,
        liquidityReservePct: d.liquidity_reserve_pct,
        drawdownPauseThresholdPct: d.drawdown_pause_threshold_pct ?? null,
        volTargetBps:        d.vol_target_bps ?? null,
        hedgeMultiplier:     d.hedge_multiplier,
      },
    });

    res.status(201).json({ id: portfolio.id, object_id: portfolio.objectId });
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
        cycles: {
          orderBy: { createdAt: 'desc' },
          take: 100,
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
        openPositions: {
          where: { settledAt: null },
          select: {
            id: true,
            oracleId: true,
            positionType: true,
            marketKey: true,
            notionalRaw: true,
            quantityRaw: true,
            expiryMs: true,
            createdAt: true,
          },
        },
        vaultConfig: { select: { id: true, name: true, isPublic: true } },
      },
    });

    if (!p) { res.status(404).json({ error: 'Portfolio not found' }); return; }

    const strategyType = STRATEGY_TO_NUM[p.strategy] ?? 0;
    const latestCycle = p.cycles[0];
    const latestNav = b(latestCycle?.navPerShareAfter) ?? '1000000000';

    // Compute total return % from latest NAV
    const latestNavNum = Number(latestNav);
    const totalReturnPct = latestNavNum !== 0
      ? ((latestNavNum - 1_000_000_000) / 1_000_000_000) * 100
      : null;

    // NAV history from cycles (ascending order)
    const navHistory = [...p.cycles]
      .reverse()
      .filter(c => c.navPerShareAfter != null)
      .map(c => ({
        ts: c.createdAt.toISOString(),
        navPerShare: b(c.navPerShareAfter)!,
      }));

    res.json({
      id:                 p.id,
      name:               p.name ?? STRATEGY_DISPLAY[p.strategy] ?? p.strategy,
      walletAddress:      p.ownerAddress,
      strategyType,
      vaultObjectId:      p.objectId,
      navPerShareRaw:     latestNav,
      totalDepositedRaw:  b(p.totalDepositedRaw) ?? '0',
      totalDeposited:     (Number(p.totalDepositedRaw ?? 0n) / 1e6).toFixed(2),
      isPaused:           p.isPaused,
      pauseReason:        p.pauseReason,
      utilTarget:         p.utilTarget,
      volTargetBps:       p.volTargetBps,
      minAtmVolOverride:  p.minAtmVolOverride,
      strikeSelection:    p.strikeSelection,
      liquidityReservePct: p.liquidityReservePct,
      drawdownPauseThresholdPct: p.drawdownPauseThresholdPct,
      sealBlobId:         p.vaultConfig?.id ?? null,
      copyFeeRaw:         null,
      createdAt:          p.createdAt.toISOString(),
      lastKeeperRun:      latestCycle?.createdAt.toISOString() ?? null,
      totalReturnPct,
      rollingApyPct:      null,
      maxDrawdownPct:     null,
      navHistory,
      openPositions: p.openPositions.map(pos => ({
        id:           pos.id,
        marketId:     pos.marketKey,
        marketType:   'predict',
        positionType: pos.positionType,
        strikeOrRange: pos.marketKey,
        sizeRaw:      b(pos.quantityRaw)!,
        notional:     b(pos.notionalRaw)!,
        expiryMs:     b(pos.expiryMs)!,
        maxPayout:    b(pos.quantityRaw)!,
        currentValueRaw: null,
        openedAt:     pos.createdAt.toISOString(),
      })),
      cycles:        p.cycles.map(serializeCycle),
      recentCycles:  p.cycles.slice(0, 10).map(serializeCycle),
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
        ...(body.name          !== undefined ? { name: body.name } : {}),
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
