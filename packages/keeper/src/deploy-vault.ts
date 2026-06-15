/**
 * deploy-vault.ts — User-facing bot deployment CLI (Phase 7).
 *
 * Creates a named bot (VaultConfig) with full per-portfolio configuration.
 * One SonarkPortfolio is deployed per strategy in the allocation mix.
 * All Phase 7 config fields are accepted and stored in the DB.
 *
 * Usage:
 *   # Single strategy, quick start
 *   pnpm --filter @sonarkk/keeper exec tsx src/deploy-vault.ts \
 *     --name "My PLP Bot" --strategy PLP_SUPPLIER --deposit 50
 *
 *   # Multi-strategy bot (60/40 Hedged-PLP / PLP)
 *   pnpm --filter @sonarkk/keeper exec tsx src/deploy-vault.ts \
 *     --name "Alice's Bot" \
 *     --strategies HEDGED_PLP,PLP_SUPPLIER \
 *     --allocations 6000,4000 \
 *     --deposit 50 \
 *     --util-target 0.25 \
 *     --drawdown-pause 0.10 \
 *     --stop-loss 20 \
 *     --policy-expiry-days 30
 *
 *   # Private vault with copy fee
 *   pnpm --filter @sonarkk/keeper exec tsx src/deploy-vault.ts \
 *     --name "Pro Vol Bot" \
 *     --strategies HEDGED_PLP,VOL_TARGETED_RANGE \
 *     --allocations 7000,3000 \
 *     --deposit 100 \
 *     --private \
 *     --copy-fee 5 \
 *     --vol-target-bps 2000 \
 *     --strike OTM_1
 *
 * Strategies: PLP_SUPPLIER | HEDGED_PLP | SMART_VAULT | PRINCIPAL_PROTECTED |
 *             RANGE_ROLL | VOL_TARGETED_RANGE | CROSS_VENUE_ARB
 * Allocations: basis points, must sum to 10000 (=100%).
 * Amounts: human-readable DUSDC (e.g. --deposit 50 = 50 DUSDC = 50_000_000 raw).
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
import { getPrismaClient, disconnectPrisma } from '@sonarkk/core';
import { env, CLOCK_ID, EXPLORER_URL } from './env.js';
import { createPredictManager } from './chain/execute.js';

const SONARK_PKG = env.SONARK_PACKAGE;
const PREDICT_PKG = env.PREDICT_PACKAGE;
const PREDICT_OBJ = env.PREDICT_OBJECT;
const DUSDC = env.DUSDC_TYPE;

// ── Strategy metadata ──────────────────────────────────────────────────────────

type StrategyType =
  | 'PLP_SUPPLIER'
  | 'HEDGED_PLP'
  | 'SMART_VAULT'
  | 'PRINCIPAL_PROTECTED'
  | 'RANGE_ROLL'
  | 'VOL_TARGETED_RANGE'
  | 'CROSS_VENUE_ARB';

const VALID_STRATEGIES = new Set<string>([
  'PLP_SUPPLIER', 'HEDGED_PLP', 'SMART_VAULT', 'PRINCIPAL_PROTECTED',
  'RANGE_ROLL', 'VOL_TARGETED_RANGE', 'CROSS_VENUE_ARB',
]);

const BETTOR_STRATEGIES = new Set<string>([
  'RANGE_ROLL', 'VOL_TARGETED_RANGE', 'CROSS_VENUE_ARB',
]);

const NEEDS_PREDICT_MANAGER = new Set<string>([
  'RANGE_ROLL', 'VOL_TARGETED_RANGE', 'CROSS_VENUE_ARB', 'PRINCIPAL_PROTECTED',
]);

// ── CLI arg parser ─────────────────────────────────────────────────────────────

interface DeployConfig {
  name: string;
  strategies: StrategyType[];
  allocationBps: number[];
  depositDusdc: number;                  // human-readable DUSDC
  ownerAddress: string | null;           // null = keeper address
  // Phase 7 per-portfolio config
  utilTarget: number;
  volTargetBps: number | null;
  minAtmVol: number | null;
  strikeSelection: 'ATM' | 'OTM_1' | 'OTM_2';
  liquidityReservePct: number;
  drawdownPausePct: number | null;
  stopLossDusdc: number | null;
  hedgeMultiplier: number;
  // VaultConfig settings
  isPublic: boolean;
  copyFeeDusdc: number | null;
  budgetCapPerCycleDusdc: number | null;
  policyExpiryDays: number;
}

function parseArgs(argv: string[]): DeployConfig {
  const get = (flag: string): string | null => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1]! : null;
  };
  const has = (flag: string): boolean => argv.includes(flag);

  // Strategy parsing: --strategy X (single) or --strategies X,Y (multi)
  let strategies: StrategyType[] = [];
  let allocationBps: number[] = [];

  const single = get('--strategy');
  const multi = get('--strategies');
  const allocStr = get('--allocations');

  if (multi) {
    strategies = multi.split(',').map(s => s.trim()) as StrategyType[];
    if (allocStr) {
      allocationBps = allocStr.split(',').map(s => parseInt(s.trim(), 10));
    } else {
      // Default: equal allocation
      const each = Math.floor(10000 / strategies.length);
      allocationBps = strategies.map((_, i) =>
        i === strategies.length - 1 ? 10000 - each * (strategies.length - 1) : each,
      );
    }
  } else if (single) {
    strategies = [single as StrategyType];
    allocationBps = [10000];
  }

  if (strategies.length === 0) {
    throw new Error('Specify at least one strategy: --strategy X  or  --strategies X,Y');
  }
  if (strategies.length !== allocationBps.length) {
    throw new Error(`--strategies and --allocations must have same count`);
  }

  const depositStr = get('--deposit');
  if (!depositStr) throw new Error('--deposit <DUSDC amount> is required');

  const strikeStr = (get('--strike') ?? 'ATM') as 'ATM' | 'OTM_1' | 'OTM_2';
  if (!['ATM', 'OTM_1', 'OTM_2'].includes(strikeStr)) {
    throw new Error(`--strike must be ATM, OTM_1, or OTM_2, got "${strikeStr}"`);
  }

  return {
    name: get('--name') ?? 'My Sonark Bot',
    strategies,
    allocationBps,
    depositDusdc: parseFloat(depositStr),
    ownerAddress: get('--owner'),
    utilTarget: parseFloat(get('--util-target') ?? '0.25'),
    volTargetBps: get('--vol-target-bps') ? parseInt(get('--vol-target-bps')!, 10) : null,
    minAtmVol: get('--min-atm-vol') ? parseFloat(get('--min-atm-vol')!) : null,
    strikeSelection: strikeStr,
    liquidityReservePct: parseFloat(get('--liquidity-reserve') ?? '0'),
    drawdownPausePct: get('--drawdown-pause') ? parseFloat(get('--drawdown-pause')!) : null,
    stopLossDusdc: get('--stop-loss') ? parseFloat(get('--stop-loss')!) : null,
    hedgeMultiplier: parseFloat(get('--hedge-multiplier') ?? '1.0'),
    isPublic: !has('--private'),
    copyFeeDusdc: get('--copy-fee') ? parseFloat(get('--copy-fee')!) : null,
    budgetCapPerCycleDusdc: get('--budget-cap-per-cycle') ? parseFloat(get('--budget-cap-per-cycle')!) : null,
    policyExpiryDays: parseInt(get('--policy-expiry-days') ?? '30', 10),
  };
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateConfig(cfg: DeployConfig): void {
  const errors: string[] = [];

  for (const s of cfg.strategies) {
    if (!VALID_STRATEGIES.has(s)) errors.push(`Unknown strategy: "${s}"`);
  }

  const totalBps = cfg.allocationBps.reduce((s, n) => s + n, 0);
  if (totalBps !== 10000) {
    errors.push(`Allocation bps must sum to 10000, got ${totalBps}`);
  }

  if (cfg.depositDusdc <= 0 || isNaN(cfg.depositDusdc)) {
    errors.push('--deposit must be a positive number');
  }

  if (cfg.utilTarget < 0.01 || cfg.utilTarget > 1.0) {
    errors.push('--util-target must be between 0.01 and 1.0');
  }

  if (cfg.minAtmVol !== null && cfg.minAtmVol < 0.10) {
    errors.push('--min-atm-vol cannot be below 0.10 (10% hard floor) — use 0.10 or above');
  }

  if (cfg.liquidityReservePct < 0 || cfg.liquidityReservePct >= 0.95) {
    errors.push('--liquidity-reserve must be between 0 and 0.95');
  }

  if (cfg.drawdownPausePct !== null && (cfg.drawdownPausePct <= 0 || cfg.drawdownPausePct >= 1)) {
    errors.push('--drawdown-pause must be between 0 (exclusive) and 1');
  }

  if (cfg.stopLossDusdc !== null && cfg.stopLossDusdc <= 0) {
    errors.push('--stop-loss must be positive');
  }

  if (cfg.stopLossDusdc !== null && cfg.stopLossDusdc >= cfg.depositDusdc) {
    errors.push('--stop-loss floor must be less than --deposit amount');
  }

  if (cfg.policyExpiryDays < 1 || cfg.policyExpiryDays > 365) {
    errors.push('--policy-expiry-days must be between 1 and 365');
  }

  if (!cfg.isPublic && cfg.copyFeeDusdc === null) {
    console.warn('  [warn] Private vault with no copy fee — anyone who discovers the vault ID can copy for free');
  }

  if (cfg.strategies.includes('VOL_TARGETED_RANGE') && cfg.volTargetBps === null) {
    console.warn('  [warn] VOL_TARGETED_RANGE without --vol-target-bps — using default 2000 (20%)');
  }

  if (cfg.strategies.includes('PRINCIPAL_PROTECTED') && !env.MOCK_LENDING_ID) {
    errors.push('MOCK_LENDING_ID not set in .env — required for PRINCIPAL_PROTECTED strategy');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.map(e => `  • ${e}`).join('\n')}`);
  }
}

// ── On-chain helpers ───────────────────────────────────────────────────────────

function log(label: string, value: string | number | bigint) {
  console.log(`  ${label.padEnd(36)}: ${value}`);
}
function step(n: number, title: string) {
  console.log(`\n${'─'.repeat(66)}\n  Step ${n} — ${title}\n${'─'.repeat(66)}`);
}

function extractPortfolioObjects(
  effects: SuiClientTypes.TransactionEffects,
  keeperAddress: string,
): { portfolioId: string; policyCapId: string } {
  let portfolioId = '';
  let policyCapId = '';
  for (const obj of effects.changedObjects) {
    if (obj.idOperation !== 'Created' || obj.outputState === 'PackageWrite') continue;
    const owner = obj.outputOwner;
    if (!owner) continue;
    if (owner.$kind === 'Shared') {
      portfolioId = obj.objectId;
    } else if (owner.$kind === 'AddressOwner' && owner.AddressOwner === keeperAddress) {
      policyCapId = obj.objectId;
    }
  }
  if (!portfolioId) throw new Error('SonarkPortfolio shared object not found in TX effects');
  if (!policyCapId) throw new Error('PolicyCap owned object not found in TX effects');
  return { portfolioId, policyCapId };
}

async function createPortfolioOnChain(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  keeperAddress: string,
  budgetCapRaw: bigint,
  expiryMs: bigint,
): Promise<{ portfolioId: string; policyCapId: string; txDigest: string }> {
  const tx = new Transaction();
  const policyCap = tx.moveCall({
    target: `${SONARK_PKG}::portfolio::create`,
    typeArguments: [DUSDC],
    arguments: [
      tx.pure.u64(budgetCapRaw),
      tx.pure.u64(expiryMs),
      tx.object(CLOCK_ID),
    ],
  });
  tx.transferObjects([policyCap], keeperAddress);

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx, signer: keypair, include: { effects: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(`portfolio::create failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }
  const digest = result.Transaction!.digest;
  await client.core.waitForTransaction({ digest });
  const effects = result.Transaction!.effects as SuiClientTypes.TransactionEffects;
  const objects = extractPortfolioObjects(effects, keeperAddress);
  return { ...objects, txDigest: digest };
}

async function depositDusdc(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  keeperAddress: string,
  portfolioId: string,
  amountRaw: bigint,
): Promise<string> {
  const coins = await client.core.listCoins({ owner: keeperAddress, coinType: DUSDC });
  const total = coins.objects.reduce((s, c) => s + BigInt(c.balance), 0n);
  if (total < amountRaw) {
    throw new Error(`Insufficient DUSDC: have ${total} raw, need ${amountRaw} raw`);
  }

  const tx = new Transaction();
  const [primary, ...rest] = coins.objects;
  if (!primary) throw new Error('no DUSDC coin objects');
  const base = tx.object(primary.objectId);
  if (rest.length > 0) tx.mergeCoins(base, rest.map(c => tx.object(c.objectId)));
  const [split] = tx.splitCoins(base, [tx.pure.u64(amountRaw)]);

  const share = tx.moveCall({
    target: `${SONARK_PKG}::portfolio::deposit`,
    typeArguments: [DUSDC],
    arguments: [tx.object(portfolioId), split, tx.object(CLOCK_ID)],
  });
  tx.transferObjects([share], keeperAddress);

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx, signer: keypair, include: { effects: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(`portfolio::deposit failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }
  const digest = result.Transaction!.digest;
  await client.core.waitForTransaction({ digest });
  return digest;
}

async function enablePrincipalProtected(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  managerId: string,
  mockLendingId: string,
  depositAmountRaw: bigint,
): Promise<string> {
  const tx = new Transaction();
  // Lock principal in mock_lending and configure portfolio for PP mode.
  tx.moveCall({
    target: `${SONARK_PKG}::portfolio::enable_principal_protected`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.object(policyCapId),
      tx.object(managerId),
      tx.object(mockLendingId),
      tx.pure.u64(depositAmountRaw),
      tx.object(CLOCK_ID),
    ],
  });
  const result = await client.core.signAndExecuteTransaction({
    transaction: tx, signer: keypair, include: { effects: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(`enable_principal_protected failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }
  const digest = result.Transaction!.digest;
  await client.core.waitForTransaction({ digest });
  return digest;
}

// ── Main deploy logic ──────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║          Sonark — Deploy Vault (Phase 7)                  ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const cfg = parseArgs(process.argv.slice(2));
  validateConfig(cfg);

  const keypair = (() => {
    try { return Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY); }
    catch { return Ed25519Keypair.fromSecretKey(Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64').slice(1)); }
  })();
  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  const ownerAddress = cfg.ownerAddress ?? keeperAddress;

  const client = new SuiGrpcClient({ network: env.SUI_NETWORK as 'testnet', baseUrl: env.SUI_GRPC_URL });
  const prisma = getPrismaClient();

  // ── Print config summary ───────────────────────────────────────────────────
  console.log('  Bot configuration:');
  log('Name', cfg.name);
  log('Owner', ownerAddress);
  log('Strategies', cfg.strategies.join(', '));
  log('Allocations (bps)', cfg.allocationBps.join(', '));
  log('Total deposit (DUSDC)', cfg.depositDusdc);
  log('Util target', `${(cfg.utilTarget * 100).toFixed(0)}%`);
  log('Strike selection', cfg.strikeSelection);
  log('Liquidity reserve', `${(cfg.liquidityReservePct * 100).toFixed(0)}%`);
  if (cfg.drawdownPausePct) log('Drawdown pause at', `${(cfg.drawdownPausePct * 100).toFixed(0)}% from peak`);
  if (cfg.stopLossDusdc) log('Stop-loss floor', `${cfg.stopLossDusdc} DUSDC`);
  if (cfg.minAtmVol) log('Min ATM vol override', `${(cfg.minAtmVol * 100).toFixed(0)}%`);
  if (cfg.volTargetBps) log('Vol target (bps)', cfg.volTargetBps);
  log('Public vault', cfg.isPublic ? 'yes' : `no (copy fee: ${cfg.copyFeeDusdc ?? 0} DUSDC)`);
  log('Policy expiry', `${cfg.policyExpiryDays} days`);

  // ── Derived constants ──────────────────────────────────────────────────────
  const depositRaw = BigInt(Math.round(cfg.depositDusdc * 1e6));
  const stopLossRaw = cfg.stopLossDusdc != null
    ? BigInt(Math.round(cfg.stopLossDusdc * 1e6)) : null;
  const copyFeeRaw = cfg.copyFeeDusdc != null
    ? BigInt(Math.round(cfg.copyFeeDusdc * 1e6)) : null;

  // Policy lifetime budget cap: default = deposit * 2 (generous; per-cycle sizing limits actual spend)
  const budgetCapPerCycleRaw = cfg.budgetCapPerCycleDusdc != null
    ? BigInt(Math.round(cfg.budgetCapPerCycleDusdc * 1e6))
    : null;
  const lifetimeBudgetRaw = budgetCapPerCycleRaw
    ? budgetCapPerCycleRaw * BigInt(cfg.policyExpiryDays * 24) // ~24 sub-hour cycles per day
    : depositRaw * 2n;

  const expiryMs = BigInt(Date.now() + cfg.policyExpiryDays * 24 * 3600 * 1000);

  // ── Step 1: Check DUSDC balance ────────────────────────────────────────────
  step(1, 'Check DUSDC balance');
  const coins = await client.core.listCoins({ owner: keeperAddress, coinType: DUSDC });
  const totalDusdc = coins.objects.reduce((s, c) => s + BigInt(c.balance), 0n);
  log('Available DUSDC (raw)', totalDusdc.toString());
  log('Required (raw)', depositRaw.toString());
  if (totalDusdc < depositRaw) {
    throw new Error(`Insufficient DUSDC: have ${Number(totalDusdc) / 1e6}, need ${cfg.depositDusdc}`);
  }

  // ── Step 2: Create VaultConfig in DB ──────────────────────────────────────
  step(2, 'Create VaultConfig in database');
  const allocationJson = cfg.strategies.map((s, i) => ({
    strategy: s,
    allocationBps: cfg.allocationBps[i]!,
  }));
  const vaultConfig = await prisma.vaultConfig.create({
    data: {
      name: cfg.name,
      creatorAddress: ownerAddress,
      allocations: JSON.stringify(allocationJson),
      isPublic: cfg.isPublic,
      budgetCapPerCycleRaw,
      policyExpiryDays: cfg.policyExpiryDays,
      copyFeeRaw,
    },
  });
  log('VaultConfig DB ID', vaultConfig.id);

  // ── Step 3: Deploy one portfolio per strategy ──────────────────────────────
  step(3, `Deploy ${cfg.strategies.length} portfolio(s)`);
  const deployedPortfolioIds: string[] = [];

  for (let i = 0; i < cfg.strategies.length; i++) {
    const strategy = cfg.strategies[i]!;
    const allocBps = cfg.allocationBps[i]!;
    const strategyDepositRaw = (depositRaw * BigInt(allocBps)) / 10000n;

    console.log(`\n  [${i + 1}/${cfg.strategies.length}] ${strategy} (${allocBps / 100}% = ${Number(strategyDepositRaw) / 1e6} DUSDC)`);

    // 3a. Create portfolio on-chain
    const { portfolioId, policyCapId, txDigest: createDigest } =
      await createPortfolioOnChain(client, keypair, keeperAddress, lifetimeBudgetRaw, expiryMs);
    log('  Portfolio ID', portfolioId);
    log('  PolicyCap ID', policyCapId);
    log('  Create TX', `${EXPLORER_URL}/${createDigest}`);

    // 3b. Create PredictManager if needed
    let managerId: string | null = null;
    if (NEEDS_PREDICT_MANAGER.has(strategy)) {
      managerId = await createPredictManager(client, keypair);
      log('  PredictManager ID', managerId);

      // 3c. Enable principal-protected mode if needed
      if (strategy === 'PRINCIPAL_PROTECTED' && env.MOCK_LENDING_ID) {
        const ppDigest = await enablePrincipalProtected(
          client, keypair, portfolioId, policyCapId, managerId,
          env.MOCK_LENDING_ID, strategyDepositRaw,
        );
        log('  PP enable TX', `${EXPLORER_URL}/${ppDigest}`);
      }
    }

    // 3d. Deposit DUSDC
    const depositDigest = await depositDusdc(
      client, keypair, keeperAddress, portfolioId, strategyDepositRaw,
    );
    log('  Deposit TX', `${EXPLORER_URL}/${depositDigest}`);

    // 3e. Register in DB with full Phase 7 config
    const dbPortfolio = await prisma.portfolio.create({
      data: {
        objectId: portfolioId,
        ownerAddress,
        policyCapId,
        strategy,
        isActive: true,
        hedgeMultiplier: strategy === 'HEDGED_PLP' ? cfg.hedgeMultiplier : 1.0,
        managerId,
        vaultConfigId: vaultConfig.id,
        // Phase 7 config
        utilTarget: cfg.utilTarget,
        volTargetBps: strategy === 'VOL_TARGETED_RANGE' ? cfg.volTargetBps : null,
        minAtmVolOverride: cfg.minAtmVol,
        strikeSelection: cfg.strikeSelection,
        liquidityReservePct: cfg.liquidityReservePct,
        drawdownPauseThresholdPct: cfg.drawdownPausePct,
        stopLossFloorRaw: stopLossRaw,
        peakNavPerShareRaw: null,   // set by keeper on first cycle
        isPaused: false,
        pauseReason: null,
      },
    });
    log('  DB Portfolio ID', dbPortfolio.id);
    deployedPortfolioIds.push(portfolioId);
  }

  // ── Step 4: Print .env additions ──────────────────────────────────────────
  console.log('\n' + '═'.repeat(66));
  console.log('  DEPLOYMENT COMPLETE');
  console.log('═'.repeat(66));
  console.log(`\n  Bot name       : ${cfg.name}`);
  console.log(`  VaultConfig ID : ${vaultConfig.id}`);
  console.log(`  Portfolios     : ${deployedPortfolioIds.length}`);
  console.log(`  Total deposit  : ${cfg.depositDusdc} DUSDC`);
  console.log(`  Expires        : ${new Date(Number(expiryMs)).toISOString()}`);
  if (!cfg.isPublic) {
    console.log(`  Visibility     : PRIVATE (copy fee: ${cfg.copyFeeDusdc ?? 0} DUSDC)`);
  }
  console.log('\n  Deployed portfolio IDs:');
  for (let i = 0; i < cfg.strategies.length; i++) {
    console.log(`    ${cfg.strategies[i]!.padEnd(22)} → ${deployedPortfolioIds[i]}`);
  }
  console.log('\n  The keeper will pick these up automatically on the next cycle.');
  console.log('  To start the keeper:');
  console.log('    pnpm --filter @sonarkk/keeper start');
  console.log('═'.repeat(66) + '\n');

  await disconnectPrisma();
}

main().catch((err) => {
  console.error('[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
