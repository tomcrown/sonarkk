/**
 * deploy-all-strategies.ts — Deploy all 8 strategies for Phase 7 testing.
 *
 * What it does:
 *   1. Deploys one SonarkPortfolio<DUSDC> per strategy (8 total).
 *   2. For bettor strategies (④⑤⑥⑦⑧), creates a PredictManager and registers it.
 *   3. For strategy ④ PRINCIPAL_PROTECTED, enables the principal-protected mode.
 *   4. Deposits DUSDC into each portfolio per the budget allocation below.
 *   5. Registers all portfolios in the DB.
 *   6. Creates TWO VaultConfigs:
 *      a. "House Vault" — all house strategies (①②③④)
 *      b. "Alice's Bot" — HEDGED_PLP 60% + RANGE_ROLL 40% (multi-strategy demo)
 *   7. Prints all object IDs and DB record IDs for .env additions.
 *
 * Budget: 110 DUSDC total. Allocation:
 *   ① PLP_SUPPLIER        — 15 DUSDC
 *   ② HEDGED_PLP          — 20 DUSDC
 *   ③ SMART_VAULT         — 15 DUSDC
 *   ④ PRINCIPAL_PROTECTED — 15 DUSDC (principal = 14 DUSDC, 1 DUSDC buffer)
 *   ⑤ RANGE_ROLL          — 10 DUSDC
 *   ⑥ VOL_TARGETED_RANGE  — 10 DUSDC
 *   ⑦ CROSS_VENUE_ARB     — 10 DUSDC
 *   ⑧ MARGIN_LOOP         — 10 DUSDC (collateral; borrowed DUSDC goes to mint_range)
 *   Reserve (gas + fees)  — 5 DUSDC
 *
 * Run:
 *   pnpm --filter @sonarkk/keeper exec tsx src/deploy-all-strategies.ts
 *
 * Pre-requisites:
 *   - Keeper wallet funded with ≥100 DUSDC + SUI for gas
 *   - SONARK_PACKAGE, PREDICT_PACKAGE, MOCK_LENDING_ID all set in .env
 *   - Existing portfolios from prior phases are OK — this adds NEW portfolios
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
import { getPrismaClient, disconnectPrisma } from '@sonarkk/core';
import { env, CLOCK_ID, PLP_TYPE, EXPLORER_URL } from './env.js';
import { createPredictManager } from './chain/execute.js';
import { createVaultConfig } from './jobs/vault-config.js';

const PREDICT_PACKAGE = env.PREDICT_PACKAGE;
const PREDICT_OBJECT  = env.PREDICT_OBJECT;
const SONARK_PACKAGE  = env.SONARK_PACKAGE;
const DUSDC_TYPE      = env.DUSDC_TYPE;

// Per-strategy deposit amounts (6 decimals).
const STRATEGY_DEPOSITS: Record<string, bigint> = {
  PLP_SUPPLIER:        15_000_000n,   // 15 DUSDC
  HEDGED_PLP:          20_000_000n,   // 20 DUSDC
  SMART_VAULT:         15_000_000n,   // 15 DUSDC
  PRINCIPAL_PROTECTED: 15_000_000n,   // 15 DUSDC (already on-chain; not re-deposited on resume)
  RANGE_ROLL:           5_000_000n,   //  5 DUSDC (reduced for budget)
  VOL_TARGETED_RANGE:   5_000_000n,   //  5 DUSDC
  CROSS_VENUE_ARB:      5_000_000n,   //  5 DUSDC
  MARGIN_LOOP:         10_000_000n,   // 10 DUSDC (collateral; keeper borrows against it to mint_range)
};

// Known orphaned PRINCIPAL_PROTECTED portfolio (deployed but not in DB due to prior failure).
// Set to null when doing a full redeploy from scratch (e.g. after contract republish).
const PP_RESUME: { portfolioId: string; policyCapId: string; managerId: string | null } | null = null;

// Strategies that need a PredictManager (bettor strategies + ④⑧).
const NEEDS_MANAGER = new Set(['PRINCIPAL_PROTECTED', 'RANGE_ROLL', 'VOL_TARGETED_RANGE', 'CROSS_VENUE_ARB', 'MARGIN_LOOP']);

// Strategy ④ principal amount (14 DUSDC of the 15 DUSDC deposit).
const PRINCIPAL_PROTECTED_PRINCIPAL = 14_000_000n;

// PolicyCap settings (7-day expiry, 50 DUSDC budget cap).
const BUDGET_CAP  = 50_000_000n;
const EXPIRY_MS   = BigInt(Date.now() + 7 * 24 * 3600 * 1000);

function log(label: string, value: string | bigint | number) {
  console.log(`  ${label.padEnd(34)}: ${value}`);
}
function step(title: string) {
  console.log(`\n${'─'.repeat(66)}\n  ${title}\n${'─'.repeat(66)}`);
}

interface DeployedPortfolio {
  strategy: string;
  portfolioId: string;
  policyCapId: string;
  managerId: string | null;
  depositRaw: bigint;
  dbId: string;
}

async function main() {
  console.log('=== Sonark Phase 7 — Deploy All 8 Strategies ===\n');

  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  }
  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  log('Keeper address', keeperAddress);
  log('Sonark package', SONARK_PACKAGE);
  log('Predict package', PREDICT_PACKAGE);

  const client = new SuiGrpcClient({
    network: env.SUI_NETWORK as 'testnet',
    baseUrl: env.SUI_GRPC_URL,
  });

  const prisma = getPrismaClient();

  // ── Load already-deployed strategies from DB (resume support) ────────────────
  step('Step 0 — Check already-deployed strategies in DB');
  const allInDb = await prisma.portfolio.findMany({
    where: { isActive: true, strategy: { in: Object.keys(STRATEGY_DEPOSITS) } },
    orderBy: { createdAt: 'asc' },
  });
  // Deduplicate: keep only the most recent active portfolio per strategy.
  type DbPortfolio = { id: string; strategy: string; objectId: string; policyCapId: string | null; managerId: string | null };
  const latestPerStrategy = new Map<string, DbPortfolio>();
  for (const p of allInDb as DbPortfolio[]) {
    latestPerStrategy.set(p.strategy, p);  // later entries overwrite earlier ones
  }
  const alreadyInDb = [...latestPerStrategy.values()];
  const deployedStrategies = new Set(alreadyInDb.map(p => p.strategy));
  log('Already in DB', deployedStrategies.size > 0 ? [...deployedStrategies].join(', ') : 'none');

  // Declare deployed[] here so the PP_RESUME block can push to it.
  const deployed: DeployedPortfolio[] = alreadyInDb.map(p => ({
    strategy: p.strategy,
    portfolioId: p.objectId,
    policyCapId: p.policyCapId ?? '',
    managerId: p.managerId ?? null,
    depositRaw: STRATEGY_DEPOSITS[p.strategy] ?? 0n,
    dbId: p.id,
  }));

  // ── Resume orphaned PRINCIPAL_PROTECTED if needed ─────────────────────────────
  if (PP_RESUME && !deployedStrategies.has('PRINCIPAL_PROTECTED')) {
    step('Step 0b — Resume PRINCIPAL_PROTECTED (orphaned on-chain portfolio)');
    const { portfolioId: ppId, policyCapId: ppCap, managerId: ppMgr } = PP_RESUME;
    log('Portfolio', ppId);
    log('PolicyCap', ppCap);

    let finalMgr = ppMgr;
    if (!finalMgr) {
      finalMgr = await createPredictManager(client, keypair);
      log('PredictManager created', finalMgr);
    } else {
      log('PredictManager (existing)', finalMgr);
    }

    // Register manager on portfolio.
    const regTx = new Transaction();
    regTx.moveCall({
      target: `${SONARK_PACKAGE}::portfolio::register_manager`,
      typeArguments: [DUSDC_TYPE],
      arguments: [regTx.object(ppId), regTx.pure.id(finalMgr), regTx.object(ppCap), regTx.object(CLOCK_ID)],
    });
    const regRes = await client.core.signAndExecuteTransaction({ transaction: regTx, signer: keypair, include: { effects: true } });
    if (regRes.$kind === 'FailedTransaction') {
      log('WARN: register_manager failed', JSON.stringify(regRes.FailedTransaction?.status));
    } else {
      await client.core.waitForTransaction({ digest: regRes.Transaction!.digest });
      log('Manager registered', regRes.Transaction!.digest.slice(0, 12) + '...');
    }

    // Enable principal-protected.
    const ppTx = new Transaction();
    ppTx.moveCall({
      target: `${SONARK_PACKAGE}::portfolio::enable_principal_protected`,
      typeArguments: [DUSDC_TYPE],
      arguments: [ppTx.object(ppId), ppTx.pure.u64(PRINCIPAL_PROTECTED_PRINCIPAL), ppTx.object(ppCap), ppTx.object(CLOCK_ID)],
    });
    const ppRes = await client.core.signAndExecuteTransaction({ transaction: ppTx, signer: keypair, include: { effects: true } });
    if (ppRes.$kind === 'FailedTransaction') {
      log('WARN: enable_principal_protected failed', JSON.stringify(ppRes.FailedTransaction?.status));
    } else {
      await client.core.waitForTransaction({ digest: ppRes.Transaction!.digest });
      log('Principal-protected enabled', ppRes.Transaction!.digest.slice(0, 12) + '...');
    }

    // Register in DB.
    const ppDbRecord = await prisma.portfolio.create({
      data: { strategy: 'PRINCIPAL_PROTECTED', objectId: ppId, policyCapId: ppCap,
        managerId: finalMgr, ownerAddress: keeperAddress, isActive: true },
    });
    log('DB ID', ppDbRecord.id);
    deployed.push({ strategy: 'PRINCIPAL_PROTECTED', portfolioId: ppId, policyCapId: ppCap,
      managerId: finalMgr, depositRaw: 15_000_000n, dbId: ppDbRecord.id });
    deployedStrategies.add('PRINCIPAL_PROTECTED');
  }

  // ── Check balance ────────────────────────────────────────────────────────────
  step('Step 1 — Check keeper DUSDC balance');
  const coins = await client.core.listCoins({ owner: keeperAddress, coinType: DUSDC_TYPE });
  if (coins.objects.length === 0) throw new Error('No DUSDC found for keeper wallet');
  const totalDusdc = coins.objects.reduce((s, c) => s + BigInt(c.balance), 0n);
  // Only count DUSDC needed for strategies NOT yet in DB.
  const totalNeeded = Object.entries(STRATEGY_DEPOSITS)
    .filter(([s]) => !deployedStrategies.has(s))
    .reduce((sum, [, v]) => sum + v, 0n);
  log('DUSDC balance', `${totalDusdc} raw (${Number(totalDusdc) / 1e6} DUSDC)`);
  log('Still needed', `${totalNeeded} raw (${Number(totalNeeded) / 1e6} DUSDC)`);
  if (totalDusdc < totalNeeded) {
    throw new Error(`Insufficient DUSDC: have ${Number(totalDusdc)/1e6}, need ${Number(totalNeeded)/1e6}`);
  }

  // ── Merge DUSDC coins ────────────────────────────────────────────────────────
  step('Step 2 — Merge DUSDC coins into one UTXO');
  let primaryCoinId: string;
  if (coins.objects.length > 1) {
    const mergeTx = new Transaction();
    const [primary, ...rest] = coins.objects;
    const baseCoin = mergeTx.object(primary!.objectId);
    mergeTx.mergeCoins(baseCoin, rest.map(c => mergeTx.object(c.objectId)));
    const mergeResult = await client.core.signAndExecuteTransaction({
      transaction: mergeTx, signer: keypair, include: { effects: true },
    });
    if (mergeResult.$kind === 'FailedTransaction') throw new Error('coin merge failed');
    await client.core.waitForTransaction({ digest: mergeResult.Transaction!.digest });
    primaryCoinId = primary!.objectId;
    log('Merged coins', `${coins.objects.length} → 1 (ID: ${primaryCoinId.slice(0, 12)}...)`);
  } else {
    primaryCoinId = coins.objects[0]!.objectId;
    log('Single coin', primaryCoinId.slice(0, 12) + '...');
  }

  // ── Deploy all 7 portfolios ──────────────────────────────────────────────────
  const STRATEGIES = Object.keys(STRATEGY_DEPOSITS);

  for (const strategy of STRATEGIES) {
    step(`Step 3.${STRATEGIES.indexOf(strategy) + 1} — Deploy ${strategy}`);

    // Skip strategies already registered in DB.
    if (deployedStrategies.has(strategy)) {
      log('Status', 'already deployed — skipping');
      continue;
    }

    const depositAmount = STRATEGY_DEPOSITS[strategy]!;

    // 3a. Create portfolio + PolicyCap.
    const createTx = new Transaction();
    const policyCap = createTx.moveCall({
      target: `${SONARK_PACKAGE}::portfolio::create`,
      typeArguments: [DUSDC_TYPE],
      arguments: [
        createTx.pure.u64(BUDGET_CAP),
        createTx.pure.u64(EXPIRY_MS),
        createTx.object(CLOCK_ID),
      ],
    });
    createTx.transferObjects([policyCap], keeperAddress);

    const createResult = await client.core.signAndExecuteTransaction({
      transaction: createTx, signer: keypair, include: { effects: true },
    });
    if (createResult.$kind === 'FailedTransaction') {
      throw new Error(`create TX failed for ${strategy}: ${JSON.stringify(createResult.FailedTransaction?.status)}`);
    }
    await client.core.waitForTransaction({ digest: createResult.Transaction!.digest });

    const { portfolioId, policyCapId } = extractPortfolioObjects(
      createResult.Transaction!.effects as SuiClientTypes.TransactionEffects, keeperAddress);
    log('Portfolio ID', portfolioId);
    log('PolicyCap ID', policyCapId);
    log('Create TX', `${EXPLORER_URL}/${createResult.Transaction!.digest}`);

    // 3b. Deposit DUSDC.
    const depositTx = new Transaction();
    const [depositCoin] = depositTx.splitCoins(
      depositTx.object(primaryCoinId),
      [depositTx.pure.u64(depositAmount)],
    );
    const share = depositTx.moveCall({
      target: `${SONARK_PACKAGE}::portfolio::deposit`,
      typeArguments: [DUSDC_TYPE],
      arguments: [depositTx.object(portfolioId), depositCoin, depositTx.object(CLOCK_ID)],
    });
    depositTx.transferObjects([share], keeperAddress);
    const depositResult = await client.core.signAndExecuteTransaction({
      transaction: depositTx, signer: keypair, include: { effects: true },
    });
    if (depositResult.$kind === 'FailedTransaction') {
      throw new Error(`deposit TX failed for ${strategy}: ${JSON.stringify(depositResult.FailedTransaction?.status)}`);
    }
    await client.core.waitForTransaction({ digest: depositResult.Transaction!.digest });
    log('Deposited', `${Number(depositAmount) / 1e6} DUSDC`);
    log('Deposit TX', `${EXPLORER_URL}/${depositResult.Transaction!.digest}`);

    // 3c. Create PredictManager for bettor/④ strategies.
    let managerId: string | null = null;
    if (NEEDS_MANAGER.has(strategy)) {
      managerId = await createPredictManager(client, keypair);
      log('PredictManager', managerId);

      // Register manager on portfolio.
      const regTx = new Transaction();
      regTx.moveCall({
        target: `${SONARK_PACKAGE}::portfolio::register_manager`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          regTx.object(portfolioId),
          regTx.pure.id(managerId),
          regTx.object(policyCapId),
          regTx.object(CLOCK_ID),
        ],
      });
      const regResult = await client.core.signAndExecuteTransaction({
        transaction: regTx, signer: keypair, include: { effects: true },
      });
      if (regResult.$kind === 'FailedTransaction') {
        log('WARNING: register_manager failed', JSON.stringify(regResult.FailedTransaction?.status));
        // Not fatal — manager can be registered separately.
      } else {
        await client.core.waitForTransaction({ digest: regResult.Transaction!.digest });
        log('Manager registered', regResult.Transaction!.digest.slice(0, 12) + '...');
      }
    }

    // 3d. Enable principal-protected for strategy ④.
    if (strategy === 'PRINCIPAL_PROTECTED') {
      const ppTx = new Transaction();
      ppTx.moveCall({
        target: `${SONARK_PACKAGE}::portfolio::enable_principal_protected`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          ppTx.object(portfolioId),
          ppTx.pure.u64(PRINCIPAL_PROTECTED_PRINCIPAL),
          ppTx.object(policyCapId),
          ppTx.object(CLOCK_ID),
        ],
      });
      const ppResult = await client.core.signAndExecuteTransaction({
        transaction: ppTx, signer: keypair, include: { effects: true },
      });
      if (ppResult.$kind === 'FailedTransaction') {
        log('WARNING: enable_principal_protected failed',
          JSON.stringify(ppResult.FailedTransaction?.status));
      } else {
        await client.core.waitForTransaction({ digest: ppResult.Transaction!.digest });
        log('Principal protected enabled', `${Number(PRINCIPAL_PROTECTED_PRINCIPAL) / 1e6} DUSDC locked`);
      }
    }

    // 3e. Register in DB.
    const dbRecord = await prisma.portfolio.upsert({
      where: { objectId: portfolioId },
      create: {
        objectId: portfolioId,
        ownerAddress: keeperAddress,
        policyCapId,
        strategy,
        isActive: true,
        hedgeMultiplier: strategy === 'HEDGED_PLP' ? 1.0 : 0.0,
        managerId,
      },
      update: { policyCapId, isActive: true, managerId },
    });
    log('DB ID', dbRecord.id);

    deployed.push({
      strategy,
      portfolioId,
      policyCapId,
      managerId,
      depositRaw: depositAmount,
      dbId: dbRecord.id,
    });

    console.log('');
  }

  // ── Create VaultConfigs ──────────────────────────────────────────────────────
  step('Step 4 — Create VaultConfigs');

  // 4a. "House Vault" — all house strategies.
  const housePortfolios = deployed.filter(d =>
    ['PLP_SUPPLIER', 'HEDGED_PLP', 'SMART_VAULT', 'PRINCIPAL_PROTECTED'].includes(d.strategy));
  const houseVaultId = await createVaultConfig(
    {
      name: 'House Vault',
      creatorAddress: keeperAddress,
      allocations: [
        { strategy: 'PLP_SUPPLIER',        allocationBps: 2300 },
        { strategy: 'HEDGED_PLP',          allocationBps: 3100 },
        { strategy: 'SMART_VAULT',         allocationBps: 2300 },
        { strategy: 'PRINCIPAL_PROTECTED', allocationBps: 2300 },
      ],
      isPublic: true,
    },
    housePortfolios.map(p => p.portfolioId),
  );
  log('House Vault ID', houseVaultId);

  // 4b. "Alice's Bot" — HEDGED_PLP 60% + RANGE_ROLL 40% (multi-strategy demo).
  const alicesPortfolios = deployed.filter(d =>
    ['HEDGED_PLP', 'RANGE_ROLL'].includes(d.strategy));
  const alicesVaultId = await createVaultConfig(
    {
      name: "Alice's Bot",
      creatorAddress: keeperAddress,
      allocations: [
        { strategy: 'HEDGED_PLP', allocationBps: 6000 },
        { strategy: 'RANGE_ROLL', allocationBps: 4000 },
      ],
      isPublic: true,
    },
    alicesPortfolios.map(p => p.portfolioId),
  );
  log("Alice's Bot ID", alicesVaultId);

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(66));
  console.log('  DEPLOYMENT COMPLETE');
  console.log('═'.repeat(66));
  console.log('\n  Add to .env (or update portfolio DB IDs):');
  console.log('  (portfolios are registered in DB — no env vars needed for the loop)');
  console.log('\n  Portfolio summary:');
  for (const d of deployed) {
    console.log(`    ${d.strategy.padEnd(22)} portfolio: ${d.portfolioId.slice(0, 12)}... manager: ${d.managerId?.slice(0, 12) ?? 'none'}`);
  }
  console.log(`\n  VaultConfigs:`);
  console.log(`    House Vault   : ${houseVaultId}`);
  console.log(`    Alice's Bot   : ${alicesVaultId}`);
  console.log('\n  Next steps:');
  console.log('    pnpm --filter @sonarkk/keeper run phase7-e2e');
  console.log('═'.repeat(66));

  await disconnectPrisma();
}

function extractPortfolioObjects(
  effects: SuiClientTypes.TransactionEffects,
  keeperAddress: string,
): { portfolioId: string; policyCapId: string } {
  let portfolioId = '';
  let policyCapId = '';
  for (const obj of effects.changedObjects) {
    if (obj.idOperation !== 'Created') continue;
    if (obj.outputState === 'PackageWrite') continue;
    const owner = obj.outputOwner;
    if (!owner) continue;
    if (owner.$kind === 'Shared') portfolioId = obj.objectId;
    else if (owner.$kind === 'AddressOwner' && owner.AddressOwner === keeperAddress) policyCapId = obj.objectId;
  }
  if (!portfolioId) throw new Error('SonarkPortfolio shared object not found in TX effects');
  if (!policyCapId) throw new Error('PolicyCap owned object not found in TX effects');
  return { portfolioId, policyCapId };
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
