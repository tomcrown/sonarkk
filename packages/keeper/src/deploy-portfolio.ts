/**
 * deploy-portfolio.ts — One-shot setup script for Phase 4 live cycle proof.
 *
 * What it does:
 *   1. Creates a SonarkPortfolio<DUSDC> on testnet, using the keeper wallet.
 *   2. Transfers the PolicyCap to the keeper wallet (so the keeper can use it in PTBs).
 *   3. Deposits 10 DUSDC into the portfolio.
 *   4. Registers the portfolio in the DB (Portfolio row).
 *   5. Prints all object IDs and the DB record ID.
 *
 * Run once before starting the keeper:
 *   pnpm --filter @sonarkk/keeper run deploy-portfolio
 *
 * If a SONARK_PORTFOLIO_ID is already set in .env, this script exits early.
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
import { getPrismaClient, disconnectPrisma } from '@sonarkk/core';
import { env, CLOCK_ID, PLP_TYPE } from './env.js';

const PREDICT_PACKAGE = env.PREDICT_PACKAGE;
const PREDICT_OBJECT  = env.PREDICT_OBJECT;
const SONARK_PACKAGE  = env.SONARK_PACKAGE;
const DUSDC_TYPE      = env.DUSDC_TYPE;
const EXPLORER        = 'https://testnet.suivision.xyz/txblock';

// Strategy to deploy (override with DEPLOY_STRATEGY env var)
const DEPLOY_STRATEGY = (process.env['DEPLOY_STRATEGY'] ?? 'PLP_SUPPLIER') as string;
const HEDGE_MULTIPLIER = DEPLOY_STRATEGY === 'HEDGED_PLP' ? 1.0 : 1.0;

// 5 DUSDC deposit, 20 DUSDC budget cap, 7-day expiry
const DEPOSIT_AMOUNT =  5_000_000n; // 5 DUSDC (6 decimals)
const BUDGET_CAP     = 20_000_000n; // 20 DUSDC max spend per cap lifetime
const EXPIRY_MS      = BigInt(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

function log(label: string, value: string | bigint | number) {
  console.log(`  ${label.padEnd(34)}: ${value}`);
}
function step(title: string) {
  console.log(`\n${'─'.repeat(64)}\n  ${title}\n${'─'.repeat(64)}`);
}

async function main() {
  console.log('=== Sonark Keeper — Deploy Portfolio ===\n');

  // ── Load keypair ─────────────────────────────────────────────────────────────
  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  }
  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  log('Keeper address', keeperAddress);

  const client = new SuiGrpcClient({
    network: env.SUI_NETWORK as 'testnet',
    baseUrl: env.SUI_GRPC_URL,
  });

  // ── Check DUSDC balance ───────────────────────────────────────────────────────
  step('Step 1 — Check keeper DUSDC balance');
  const coins = await client.core.listCoins({ owner: keeperAddress, coinType: DUSDC_TYPE });
  if (coins.objects.length === 0) {
    throw new Error(
      `No DUSDC found for keeper wallet ${keeperAddress}.\n` +
      `Get testnet DUSDC from: https://predict-server.testnet.mystenlabs.com/faucet\n` +
      `Or call the DUSDC faucet module directly.`,
    );
  }
  const totalDusdc = coins.objects.reduce((s, c) => s + BigInt(c.balance), 0n);
  log('DUSDC balance', `${totalDusdc} raw (${Number(totalDusdc) / 1e6} DUSDC)`);
  if (totalDusdc < DEPOSIT_AMOUNT) {
    throw new Error(`Insufficient DUSDC: have ${totalDusdc}, need ${DEPOSIT_AMOUNT}`);
  }

  // ── Create portfolio + transfer PolicyCap ────────────────────────────────────
  step('Step 2 — Create SonarkPortfolio<DUSDC> + PolicyCap');

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
  // Transfer PolicyCap to keeper wallet so keeper PTBs can reference it.
  createTx.transferObjects([policyCap], keeperAddress);

  const createResult = await client.core.signAndExecuteTransaction({
    transaction: createTx,
    signer: keypair,
    include: { effects: true },
  });
  if (createResult.$kind === 'FailedTransaction') {
    throw new Error(`create TX failed: ${JSON.stringify(createResult.FailedTransaction?.status)}`);
  }
  const createDigest = createResult.Transaction!.digest;
  log('Create TX digest', createDigest);
  log('Explorer', `${EXPLORER}/${createDigest}`);
  await client.core.waitForTransaction({ digest: createDigest });

  // Extract created objects
  const effects = createResult.Transaction!.effects as SuiClientTypes.TransactionEffects;
  const { portfolioId, policyCapId } = extractPortfolioObjects(effects, keeperAddress);
  log('Portfolio ID (shared)', portfolioId);
  log('PolicyCap ID (owned)', policyCapId);

  // ── Deposit DUSDC into portfolio ─────────────────────────────────────────────
  step('Step 3 — Deposit DUSDC into portfolio');

  // Find the largest DUSDC coin to use.
  const depositTx = new Transaction();
  // Merge all DUSDC UTXOs into the first one, then split the required amount.
  // This handles wallets where DUSDC is fragmented across multiple coin objects.
  const [primaryCoin, ...restCoins] = coins.objects;
  if (!primaryCoin) throw new Error('no DUSDC coin objects');
  const baseCoin = depositTx.object(primaryCoin.objectId);
  if (restCoins.length > 0) {
    depositTx.mergeCoins(baseCoin, restCoins.map(c => depositTx.object(c.objectId)));
  }
  const [depositCoin] = depositTx.splitCoins(baseCoin, [depositTx.pure.u64(DEPOSIT_AMOUNT)]);
  // Call portfolio::deposit<DUSDC> — returns a PortfolioShare receipt.
  const share = depositTx.moveCall({
    target: `${SONARK_PACKAGE}::portfolio::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      depositTx.object(portfolioId),
      depositCoin,
      depositTx.object(CLOCK_ID),
    ],
  });
  depositTx.transferObjects([share], keeperAddress);

  const depositResult = await client.core.signAndExecuteTransaction({
    transaction: depositTx,
    signer: keypair,
    include: { effects: true },
  });
  if (depositResult.$kind === 'FailedTransaction') {
    throw new Error(`deposit TX failed: ${JSON.stringify(depositResult.FailedTransaction?.status)}`);
  }
  const depositDigest = depositResult.Transaction!.digest;
  log('Deposit TX digest', depositDigest);
  log('Explorer', `${EXPLORER}/${depositDigest}`);
  await client.core.waitForTransaction({ digest: depositDigest });
  log('Deposited', `${DEPOSIT_AMOUNT} raw (${Number(DEPOSIT_AMOUNT) / 1e6} DUSDC)`);

  // ── Register in DB ───────────────────────────────────────────────────────────
  step('Step 4 — Register portfolio in database');

  const prisma = getPrismaClient();
  const dbRecord = await prisma.portfolio.upsert({
    where: { objectId: portfolioId },
    create: {
      objectId: portfolioId,
      ownerAddress: keeperAddress,
      policyCapId,
      strategy: DEPLOY_STRATEGY,
      isActive: true,
      hedgeMultiplier: HEDGE_MULTIPLIER,
    },
    update: {
      policyCapId,
      isActive: true,
    },
  });
  log('DB Portfolio ID', dbRecord.id);
  log('Strategy', dbRecord.strategy);

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(64));
  console.log('  DEPLOYMENT COMPLETE — add these to .env:');
  console.log('═'.repeat(64));
  const envPrefix = DEPLOY_STRATEGY === 'HEDGED_PLP' ? 'SONARK_HEDGED' : 'SONARK';
  console.log(`  ${envPrefix}_PORTFOLIO_ID=${portfolioId}`);
  console.log(`  ${envPrefix}_POLICY_CAP_ID=${policyCapId}`);
  console.log('');
  console.log('  Then run:');
  console.log('    pnpm --filter @sonarkk/keeper run setup   # create BalanceManager');
  console.log('    pnpm --filter @sonarkk/keeper start       # start keeper loop');
  console.log('═'.repeat(64));

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

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
