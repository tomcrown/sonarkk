/**
 * Copy / provenance data layer — Phase 5 Task 3.
 *
 * The strategy config is snapshotted at copy time so followers can see
 * what parameters were active when they started copying.
 *
 * Fee model (documented, not enforced on testnet):
 *   - 10% platform performance fee on positive returns (performanceFeeAccrued)
 *   - 5% copy fee on all returns while actively copying (copyFeeAccrued)
 *
 * Fee accrual is computed and stored but not collected on testnet.
 * On mainnet, the Vault contract would enforce these via the PolicyCap.
 */

import { getPrismaClient } from '@sonarkk/core';
import { log } from '../logger.js';

// ── Strategy snapshot ─────────────────────────────────────────────────────────

interface StrategyConfig {
  type: string;
  slug: string;
  name: string;
  hedgeMultiplier?: number;
  minAtmVol: number;
  feeModel: {
    platformPerformanceFeePct: number;
    copyFeePct: number;
  };
  riskDisclosure?: string;
}

// Minimum ATM vol thresholds per strategy (from CLAUDE.md binding rules).
const MIN_ATM_VOL_BY_TYPE: Record<string, number> = {
  PLP_SUPPLIER: 0.15,
  HEDGED_PLP: 0.18,
  SMART_VAULT: 0.18,
  PRINCIPAL_PROTECTED: 0.15,
  RANGE_ROLL: 0.28,
  VOL_TARGETED_RANGE: 0.28,
  CROSS_VENUE_ARB: 0.22,
};

const RISK_DISCLOSURE: Record<string, string | undefined> = {
  RANGE_ROLL: 'short-volatility strategy — profitable in calm markets, loses in volatility spikes',
  VOL_TARGETED_RANGE:
    'short-volatility strategy — profitable in calm markets, loses in volatility spikes',
  CROSS_VENUE_ARB: 'sell-vol mode only; buy-vol mode disabled without live cross-venue feed',
};

function buildStrategySnapshot(strategyType: string, hedgeMultiplier?: number): StrategyConfig {
  const slug = strategyType.toLowerCase().replace(/_/g, '-');
  const base: StrategyConfig = {
    type: strategyType,
    slug,
    name: strategyType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    minAtmVol: MIN_ATM_VOL_BY_TYPE[strategyType] ?? 0.18,
    feeModel: {
      platformPerformanceFeePct: 10,
      copyFeePct: 5,
    },
  };
  if (hedgeMultiplier !== undefined) base.hedgeMultiplier = hedgeMultiplier;
  const disclosure = RISK_DISCLOSURE[strategyType];
  if (disclosure !== undefined) base.riskDisclosure = disclosure;
  return base;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CopyRelationRecord {
  id: string;
  followerAddr: string;
  strategyId: string;
  strategyType: string;
  strategySnapshot: StrategyConfig;
  isActive: boolean;
  copiedAt: Date;
  uncopiedAt: Date | null;
  performanceFeeAccrued: number;
  copyFeeAccrued: number;
}

/**
 * Register a follower to copy a strategy.
 *
 * If the relation already exists and is inactive (uncopy was called),
 * it is reactivated with a fresh snapshot.
 *
 * @param followerAddress  Sui wallet address of the follower
 * @param strategyId       DB Strategy.id (not the on-chain vault ID)
 * @param strategyType     StrategyType enum value (for snapshot)
 * @param hedgeMultiplier  Portfolio hedge multiplier, if known
 */
export async function copyStrategy(
  followerAddress: string,
  strategyId: string,
  strategyType: string,
  hedgeMultiplier?: number,
): Promise<CopyRelationRecord> {
  const prisma = getPrismaClient();
  const snapshot = buildStrategySnapshot(strategyType, hedgeMultiplier);
  const snapshotJson = JSON.stringify(snapshot);

  const relation = await prisma.copyRelation.upsert({
    where: { followerAddr_strategyId: { followerAddr: followerAddress, strategyId } },
    create: {
      followerAddr: followerAddress,
      strategyId,
      strategySnapshot: snapshotJson,
      isActive: true,
      performanceFeeAccrued: 0,
      copyFeeAccrued: 0,
    },
    update: {
      strategySnapshot: snapshotJson,
      isActive: true,
      uncopiedAt: null,
      // Reset fees on re-copy (new copy period starts fresh).
      performanceFeeAccrued: 0,
      copyFeeAccrued: 0,
    },
  });

  log.info({ followerAddress, strategyId, strategyType }, 'copy relation created/reactivated');

  return mapRelation(relation, strategyType, snapshot);
}

/**
 * Deactivate a follower's copy relation.
 */
export async function uncopyStrategy(followerAddress: string, strategyId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.copyRelation.update({
    where: { followerAddr_strategyId: { followerAddr: followerAddress, strategyId } },
    data: {
      isActive: false,
      uncopiedAt: new Date(),
    },
  });
  log.info({ followerAddress, strategyId }, 'copy relation deactivated');
}

/**
 * Accrue fees for all active copy relations on a given strategy.
 * Called by the keeper after a successful supply cycle.
 *
 * Fee rules (documented, not collected on testnet):
 *   - performance fee: 10% of cycle return (positive only)
 *   - copy fee: 5% of AUM (annual), charged pro-rata per expiry (~0.33% per day)
 *
 * @param strategyId   DB Strategy.id
 * @param cycleReturnPct  Return this cycle in percent (can be negative)
 * @param tvlDusdc     TVL in DUSDC (for copy fee computation)
 */
export async function accrueFeesForCycle(
  strategyId: string,
  cycleReturnPct: number,
  tvlDusdc: number,
): Promise<void> {
  const prisma = getPrismaClient();
  const activeRelations = await prisma.copyRelation.findMany({
    where: { strategyId, isActive: true },
  });

  if (activeRelations.length === 0) return;

  // Performance fee: 10% of positive return on TVL.
  const performanceFeePerRelation =
    cycleReturnPct > 0 ? tvlDusdc * (cycleReturnPct / 100) * 0.1 : 0;

  // Copy fee: 5% annual / (365 * 24 / expiry_hours) per cycle.
  // Sub-hour expiries ~24x/day. Annual rate ÷ cycles_per_year.
  const ANNUAL_COPY_FEE_RATE = 0.05;
  const CYCLES_PER_YEAR_APPROX = 365 * 24; // one per hour
  const copyFeePerRelation = (tvlDusdc * ANNUAL_COPY_FEE_RATE) / CYCLES_PER_YEAR_APPROX;

  for (const relation of activeRelations) {
    await prisma.copyRelation.update({
      where: { id: relation.id },
      data: {
        performanceFeeAccrued: relation.performanceFeeAccrued + performanceFeePerRelation,
        copyFeeAccrued: relation.copyFeeAccrued + copyFeePerRelation,
      },
    });
  }

  log.info(
    { strategyId, count: activeRelations.length, performanceFeePerRelation, copyFeePerRelation },
    'fees accrued for copy relations',
  );
}

/**
 * List all copy relations for a strategy (active + inactive).
 */
export async function listCopyRelations(strategyId: string): Promise<CopyRelationRecord[]> {
  const prisma = getPrismaClient();
  const relations = await prisma.copyRelation.findMany({
    where: { strategyId },
    orderBy: { copiedAt: 'desc' },
  });

  return relations.map((r) => {
    let snapshot: StrategyConfig | undefined;
    try {
      snapshot = r.strategySnapshot
        ? (JSON.parse(r.strategySnapshot) as StrategyConfig)
        : undefined;
    } catch {
      snapshot = undefined;
    }
    return mapRelation(r, snapshot?.type ?? 'UNKNOWN', snapshot);
  });
}

/**
 * List all strategies a follower is copying.
 */
export async function listFollowerCopies(followerAddress: string): Promise<CopyRelationRecord[]> {
  const prisma = getPrismaClient();
  const relations = await prisma.copyRelation.findMany({
    where: { followerAddr: followerAddress, isActive: true },
    orderBy: { copiedAt: 'desc' },
  });

  return relations.map((r) => {
    let snapshot: StrategyConfig | undefined;
    try {
      snapshot = r.strategySnapshot
        ? (JSON.parse(r.strategySnapshot) as StrategyConfig)
        : undefined;
    } catch {
      snapshot = undefined;
    }
    return mapRelation(r, snapshot?.type ?? 'UNKNOWN', snapshot);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapRelation(
  r: {
    id: string;
    followerAddr: string;
    strategyId: string;
    isActive: boolean;
    copiedAt: Date;
    uncopiedAt: Date | null;
    performanceFeeAccrued: number;
    copyFeeAccrued: number;
  },
  strategyType: string,
  snapshot: StrategyConfig | undefined,
): CopyRelationRecord {
  return {
    id: r.id,
    followerAddr: r.followerAddr,
    strategyId: r.strategyId,
    strategyType,
    strategySnapshot: snapshot ?? buildStrategySnapshot(strategyType),
    isActive: r.isActive,
    copiedAt: r.copiedAt,
    uncopiedAt: r.uncopiedAt,
    performanceFeeAccrued: r.performanceFeeAccrued,
    copyFeeAccrued: r.copyFeeAccrued,
  };
}
