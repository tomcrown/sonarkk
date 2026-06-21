/**
 * VaultConfig data layer — named bot/vault management.
 *
 * A VaultConfig is a named collection of portfolios (one per strategy slot)
 * with defined allocation percentages. It is the unit for:
 *   - Leaderboard display: one row per VaultConfig, combined NAV across all its portfolios
 *   - Copy trading: follower copies the full strategy mix in one PTB
 *
 * Architecture:
 *   User A creates "Alice's Bot" with:
 *     - HEDGED_PLP portfolio at 60% allocation
 *     - RANGE_ROLL portfolio at 40% allocation
 *   The VaultConfig records both portfolios and their allocation %s.
 *   The leaderboard shows combined NAV + return across both.
 *   A copier deploys matching portfolios for themselves in one PTB.
 */

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fetchPredictVaultState, computeNav, getPrismaClient } from '@sonarkk/core';
import { readPortfolioChainState } from '../chain/portfolio.js';
import { env, PLP_TYPE, CLOCK_ID, EXPLORER_URL } from '../env.js';
import { log } from '../logger.js';
import { withRetry } from '../util/retry.js';

const DUSDC = env.DUSDC_TYPE;
const PREDICT_OBJ = env.PREDICT_OBJECT;
const SONARK_PKG = env.SONARK_PACKAGE;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AllocationSpec {
  strategy: string;    // StrategyType value
  allocationBps: number; // 0–10000 (must sum to 10000 across specs)
  depositAmountRaw?: bigint; // optional explicit amount; else derived from totalRaw × bps/10000
}

export interface VaultConfigInput {
  name: string;
  creatorAddress: string;
  allocations: AllocationSpec[];
  isPublic?: boolean;
}

export interface VaultCombinedNav {
  vaultConfigId: string;
  name: string;
  totalNavRaw: bigint;         // sum of all constituent portfolio NAVs
  combinedReturnPct: number | null;
  copierCount: number;
}

// ── Create VaultConfig ────────────────────────────────────────────────────────

/**
 * Create a VaultConfig record. Does NOT deploy portfolios — caller must have
 * already deployed portfolios and obtained their objectIds.
 *
 * portfolioIds must be in the same order as allocations.
 */
export async function createVaultConfig(
  input: VaultConfigInput,
  portfolioIds: string[],
): Promise<string> {
  const prisma = getPrismaClient();

  if (portfolioIds.length !== input.allocations.length) {
    throw new Error(`portfolioIds.length (${portfolioIds.length}) must match allocations.length (${input.allocations.length})`);
  }

  const totalBps = input.allocations.reduce((s, a) => s + a.allocationBps, 0);
  if (totalBps !== 10000) {
    throw new Error(`Allocations must sum to 10000 bps (100%), got ${totalBps}`);
  }

  const vaultConfig = await prisma.vaultConfig.create({
    data: {
      name: input.name,
      creatorAddress: input.creatorAddress,
      allocations: JSON.stringify(input.allocations),
      isPublic: input.isPublic ?? true,
    },
  });

  // Link portfolios to this vault config.
  await prisma.portfolio.updateMany({
    where: { objectId: { in: portfolioIds } },
    data: { vaultConfigId: vaultConfig.id },
  });

  log.info({ vaultConfigId: vaultConfig.id, name: input.name, portfolioCount: portfolioIds.length },
    'VaultConfig created');

  return vaultConfig.id;
}

// ── Aggregate NAV across VaultConfig portfolios ────────────────────────────────

/**
 * Compute the combined NAV for a VaultConfig by summing constituent portfolio NAVs.
 */
export async function computeVaultConfigNav(
  client: SuiGrpcClient,
  keeperAddress: string,
  vaultConfigId: string,
): Promise<{ totalNavRaw: bigint; portfolioNavs: Array<{ portfolioId: string; navRaw: bigint }> }> {
  const prisma = getPrismaClient();

  const vaultConfig = await prisma.vaultConfig.findUniqueOrThrow({ where: { id: vaultConfigId } });
  const portfolios = await prisma.portfolio.findMany({
    where: { vaultConfigId, isActive: true },
  });

  const vaultState = await fetchPredictVaultState(client.core, PREDICT_OBJ);

  const portfolioNavs: Array<{ portfolioId: string; navRaw: bigint }> = [];
  let totalNavRaw = 0n;

  for (const portfolio of portfolios) {
    try {
      const chainState = await readPortfolioChainState(client, portfolio.objectId, keeperAddress);
      const navComponents = await computeNav(client.core, {
        portfolio_id: portfolio.objectId,
        predict_id: PREDICT_OBJ,
        sonark_package: SONARK_PKG,
        predict_package: env.PREDICT_PACKAGE,
        dusdc_type: DUSDC,
        plp_type: PLP_TYPE,
        sender: keeperAddress,
        open_bettor_positions: [],
        locked_principal_raw: chainState.locked_principal_raw,
        yield_accumulated_raw: chainState.yield_accumulated_raw,
        vault_value_raw: vaultState.vault_value_raw,
        plp_total_supply_raw: vaultState.plp_total_supply_raw,
      });
      portfolioNavs.push({ portfolioId: portfolio.objectId, navRaw: navComponents.total_nav_raw });
      totalNavRaw += navComponents.total_nav_raw;
    } catch (err) {
      log.warn({ portfolioId: portfolio.objectId, err }, 'NAV read failed for portfolio in vault config');
      portfolioNavs.push({ portfolioId: portfolio.objectId, navRaw: 0n });
    }
  }

  log.info({ vaultConfigId, name: vaultConfig.name, totalNavRaw: totalNavRaw.toString(),
    portfolioCount: portfolios.length }, 'VaultConfig NAV computed');

  return { totalNavRaw, portfolioNavs };
}

// ── Vault-level Leaderboard ───────────────────────────────────────────────────

/**
 * Recompute the vault-level leaderboard. One row per public VaultConfig.
 *
 * Combined TVL = sum of constituent portfolio NAVs.
 * Return % = (current TVL - initial deposit) / initial deposit × 100.
 * Initial deposit is estimated from the first cycle's navPerShareBefore × total_shares.
 */
export async function runVaultLeaderboardJob(
  client: SuiGrpcClient,
  keeperAddress: string,
): Promise<void> {
  const prisma = getPrismaClient();

  const vaultConfigs = await prisma.vaultConfig.findMany({
    where: { isPublic: true, isActive: true },
    include: {
      portfolios: { where: { isActive: true } },
      _count: { select: { copies: { where: { isActive: true } } } },
    },
  });

  log.info({ count: vaultConfigs.length }, 'running vault leaderboard job');

  const entries: Array<{
    vaultConfigId: string;
    combinedTvlRaw: bigint;
    totalReturnPct: number | null;
    rollingApyPct: number | null;
    copierCount: number;
    totalCycles: number;
    successfulCycles: number;
  }> = [];

  for (const vc of vaultConfigs) {
    try {
      const { totalNavRaw } = await computeVaultConfigNav(client, keeperAddress, vc.id);

      // Sum cycle counts and initial deposits across constituent portfolios.
      const portfolioIds = vc.portfolios.map(p => p.id);
      const cycleCounts = await prisma.keeperCycle.groupBy({
        by: ['portfolioId'],
        where: { portfolioId: { in: portfolioIds } },
        _count: { _all: true },
      });
      const successCounts = await prisma.keeperCycle.groupBy({
        by: ['portfolioId'],
        where: { portfolioId: { in: portfolioIds }, status: 'done' },
        _count: { _all: true },
      });
      const totalCycles = cycleCounts.reduce((s, r) => s + r._count._all, 0);
      const successfulCycles = successCounts.reduce((s, r) => s + r._count._all, 0);

      // Compute return: (currentNAV - initialDeposit) / initialDeposit × 100
      const initialDepositRaw = vc.portfolios.reduce((s, p) => s + p.totalDepositedRaw, 0n);
      let totalReturnPct: number | null = null;
      let rollingApyPct: number | null = null;

      if (initialDepositRaw > 0n && totalNavRaw > 0n) {
        totalReturnPct = Number(totalNavRaw - initialDepositRaw) / Number(initialDepositRaw) * 100;

        // Annualize over period from first cycle to now.
        const firstCycle = await prisma.keeperCycle.findFirst({
          where: { portfolioId: { in: portfolioIds } },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        if (firstCycle) {
          const periodDays = (Date.now() - firstCycle.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          if (periodDays >= 1) {
            const r = totalReturnPct / 100;
            rollingApyPct = (Math.pow(1 + r, 365 / periodDays) - 1) * 100;
          }
        }
      }

      entries.push({
        vaultConfigId: vc.id,
        combinedTvlRaw: totalNavRaw,
        totalReturnPct,
        rollingApyPct,
        copierCount: vc._count.copies,
        totalCycles,
        successfulCycles,
      });
    } catch (err) {
      log.warn({ vaultConfigId: vc.id, err }, 'vault leaderboard entry failed');
    }
  }

  // Rank by totalReturnPct descending (nulls last), TVL as tiebreaker.
  entries.sort((a, b) => {
    if (a.totalReturnPct === null && b.totalReturnPct === null)
      return b.combinedTvlRaw > a.combinedTvlRaw ? 1 : -1;
    if (a.totalReturnPct === null) return 1;
    if (b.totalReturnPct === null) return -1;
    return b.totalReturnPct - a.totalReturnPct;
  });

  for (let rank = 0; rank < entries.length; rank++) {
    const entry = entries[rank]!;
    await prisma.vaultLeaderboardEntry.upsert({
      where: { vaultConfigId: entry.vaultConfigId },
      update: {
        rank: rank + 1,
        combinedTvlRaw: entry.combinedTvlRaw,
        totalReturnPct: entry.totalReturnPct,
        rollingApyPct: entry.rollingApyPct,
        copierCount: entry.copierCount,
        totalCycles: entry.totalCycles,
        successfulCycles: entry.successfulCycles,
        apyCaveat: 'Testnet only. Trader volume is modeled (no live flow on testnet). Not indicative of mainnet returns.',
      },
      create: {
        vaultConfigId: entry.vaultConfigId,
        rank: rank + 1,
        combinedTvlRaw: entry.combinedTvlRaw,
        totalReturnPct: entry.totalReturnPct,
        rollingApyPct: entry.rollingApyPct,
        copierCount: entry.copierCount,
        totalCycles: entry.totalCycles,
        successfulCycles: entry.successfulCycles,
        apyCaveat: 'Testnet only. Trader volume is modeled (no live flow on testnet). Not indicative of mainnet returns.',
      },
    });
  }

  log.info({ count: entries.length }, 'vault leaderboard updated');
}

// ── Copy at VaultConfig level ────────────────────────────────────────────────

/**
 * Read a VaultConfig's allocations as the canonical spec for a copy operation.
 */
export async function getVaultConfigForCopy(
  vaultConfigId: string,
): Promise<{ name: string; allocations: AllocationSpec[]; portfolios: Array<{ objectId: string; strategy: string }> }> {
  const prisma = getPrismaClient();

  const vc = await prisma.vaultConfig.findUniqueOrThrow({
    where: { id: vaultConfigId, isPublic: true, isActive: true },
    include: { portfolios: { where: { isActive: true } } },
  });

  const allocations = JSON.parse(vc.allocations) as AllocationSpec[];
  const portfolios = vc.portfolios.map(p => ({ objectId: p.objectId, strategy: p.strategy }));

  return { name: vc.name, allocations, portfolios };
}

/**
 * Record that a follower has copied a VaultConfig and link their new VaultConfig.
 */
export async function recordVaultCopy(
  originalVaultId: string,
  followerAddr: string,
  copiedVaultId: string,
): Promise<void> {
  const prisma = getPrismaClient();
  const vc = await prisma.vaultConfig.findUniqueOrThrow({ where: { id: originalVaultId } });

  await prisma.vaultCopyRelation.create({
    data: {
      followerAddr,
      originalVaultId,
      copiedVaultId,
      allocationSnapshot: vc.allocations,
    },
  });

  // Increment copier count on leaderboard.
  await prisma.vaultLeaderboardEntry.updateMany({
    where: { vaultConfigId: originalVaultId },
    data: { copierCount: { increment: 1 } },
  });

  log.info({ originalVaultId, followerAddr, copiedVaultId }, 'vault copy recorded');
}

// ── Multi-portfolio deploy PTB ────────────────────────────────────────────────

/**
 * Build a PTB that creates multiple SonarkPortfolio<DUSDC> objects + PolicyCaps
 * in a single transaction for a given set of allocations.
 *
 * The user signs ONE transaction and gets all portfolios deployed.
 * The keeper then deposits the correct DUSDC amounts into each portfolio
 * in subsequent PTBs (or the same PTB if coins are available).
 *
 * Returns: new portfolio + policyCap object IDs extracted from TX effects.
 */
export async function deployMultiPortfolioPtb(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  allocations: AllocationSpec[],
  totalDepositRaw: bigint,
  budgetCapRaw: bigint,
  expiryMs: bigint,
  dusdcCoinIds: string[],  // keeper's DUSDC UTXOs (will be merged + split)
): Promise<Array<{ portfolioId: string; policyCapId: string; strategy: string; depositedRaw: bigint }>> {
  const tx = new Transaction();
  const keeperAddress = keypair.getPublicKey().toSuiAddress();

  // Merge all DUSDC UTXOs into the first coin for splitting.
  if (dusdcCoinIds.length === 0) throw new Error('no DUSDC coins provided');
  const [primaryCoinId, ...restCoinIds] = dusdcCoinIds;
  const baseCoin = tx.object(primaryCoinId!);
  if (restCoinIds.length > 0) {
    tx.mergeCoins(baseCoin, restCoinIds.map(id => tx.object(id)));
  }

  // Validate allocations sum to 10000.
  const totalBps = allocations.reduce((s, a) => s + a.allocationBps, 0);
  if (totalBps !== 10000) throw new Error(`Allocations must sum to 10000 bps, got ${totalBps}`);

  const portfolioPlaceholders: Array<{ strategy: string; depositRaw: bigint }> = [];

  for (const alloc of allocations) {
    const depositRaw = alloc.depositAmountRaw ??
      BigInt(Math.floor(Number(totalDepositRaw) * alloc.allocationBps / 10000));
    if (depositRaw === 0n) continue;

    // Create portfolio + policyCap.
    const policyCap = tx.moveCall({
      target: `${SONARK_PKG}::portfolio::create`,
      typeArguments: [DUSDC],
      arguments: [
        tx.pure.u64(budgetCapRaw),
        tx.pure.u64(expiryMs),
        tx.object(CLOCK_ID),
      ],
    });
    // Transfer PolicyCap to the signing wallet (keeper or user).
    tx.transferObjects([policyCap], keeperAddress);

    portfolioPlaceholders.push({ strategy: alloc.strategy, depositRaw });
  }

  // Note: portfolio objectIds are shared, so the PTB can't reference them by result
  // (you can't call moveCall on a shared object created in the same PTB in Sui).
  // Instead, we create all portfolios + caps in this TX, then deposit in a second TX.
  // This is the standard Sui pattern for deploying objects that become shared.

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    'deployMultiPortfolioPtb',
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`multi-portfolio deploy TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  log.info({ digest, allocCount: allocations.length, explorer: `${EXPLORER_URL}/${digest}` },
    'multi-portfolio deploy TX confirmed');

  await client.core.waitForTransaction({ digest });

  // Extract created objects (shared = portfolios, owned by keeper = policyCaps).
  const effects = result.Transaction?.effects as {
    changedObjects?: Array<{ idOperation?: string; objectId: string; outputOwner?: { $kind?: string; AddressOwner?: string } }>
  };
  const sharedObjs: string[] = [];
  const ownedObjs: string[] = [];

  for (const obj of effects?.changedObjects ?? []) {
    if (obj.idOperation !== 'Created') continue;
    if (obj.outputOwner?.$kind === 'Shared') sharedObjs.push(obj.objectId);
    else if (obj.outputOwner?.$kind === 'AddressOwner') ownedObjs.push(obj.objectId);
  }

  if (sharedObjs.length !== portfolioPlaceholders.length) {
    log.warn({ sharedObjs: sharedObjs.length, expected: portfolioPlaceholders.length },
      'unexpected number of shared objects in deploy TX');
  }

  return portfolioPlaceholders.map((p, i) => ({
    portfolioId: sharedObjs[i] ?? '',
    policyCapId: ownedObjs[i] ?? '',
    strategy: p.strategy,
    depositedRaw: p.depositRaw,
  }));
}
