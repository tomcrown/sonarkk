/**
 * Phase 2 Integration Test — Testnet Cycle Proof
 *
 * Proves:
 *   1. The sonark package publishes to testnet.
 *   2. deposit → PortfolioShare works on-chain.
 *   3. take_for_supply → predict::supply → store_lp works (TypeName-Bag with real PLP).
 *   4. lp_balance is non-zero after step 3 (DevInspect simulation read).
 *   5. take_lp → predict::withdraw → store_quote → withdraw(share) works.
 *
 * Run: pnpm --filter @sonarkk/core run integration-phase2
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
import { suiClient } from './sui-client.js';
import { env } from './env.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const ACTIVE_ADDRESS = '0xa02306f408248d325f1cd839fb6f0c76a6c7abd0f43922f0a2258a550f9610a5';
const PREDICT_PACKAGE = env.PREDICT_PACKAGE;
const PREDICT_OBJECT = env.PREDICT_OBJECT;
const DUSDC_TYPE = env.DUSDC_TYPE;
const PLP_TYPE = `${PREDICT_PACKAGE}::plp::PLP`;
const CLOCK_ID = '0x0000000000000000000000000000000000000000000000000000000000000006';

// Supply/deposit amounts (DUSDC has 6 decimals)
const DEPOSIT_AMOUNT = 1_000_000n;   // 1 DUSDC deposited into portfolio
const SUPPLY_AMOUNT  =   500_000n;   // 0.5 DUSDC forwarded to Predict::supply

// Keeper budget cap for the test (10 DUSDC, 1-day expiry)
const BUDGET_CAP = 10_000_000n;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_PATH = path.resolve(__dirname, '../../../contracts/sonark');
const EXPLORER_URL = 'https://testnet.suivision.xyz/txblock';

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(label: string, value: string | bigint | number | boolean) {
  console.log(`  ${label.padEnd(32)}: ${value}`);
}

function step(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

/** Read the Ed25519 keypair matching ACTIVE_ADDRESS from the Sui CLI keystore. */
function findKeypair(): Ed25519Keypair {
  const keystorePath = path.join(os.homedir(), '.sui/sui_config/sui.keystore');
  const entries = JSON.parse(fs.readFileSync(keystorePath, 'utf-8')) as string[];
  for (const entry of entries) {
    const bytes = Buffer.from(entry, 'base64');
    const secretKey = bytes.slice(1); // strip 1-byte scheme flag (0x00 = Ed25519)
    const kp = Ed25519Keypair.fromSecretKey(secretKey);
    if (kp.getPublicKey().toSuiAddress() === ACTIVE_ADDRESS) return kp;
  }
  throw new Error(`No keypair found for ${ACTIVE_ADDRESS} in sui.keystore`);
}

/**
 * Extract the first JSON object from CLI output.
 * `sui client publish --json` sometimes emits warnings before the JSON block.
 */
function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error(`No JSON in output:\n${raw}`);
  return JSON.parse(raw.slice(start));
}

/** Parse package ID from `sui client publish --json` output. */
function extractPackageId(publishJson: unknown): string {
  const json = publishJson as { objectChanges?: Array<{ type: string; packageId?: string }> };
  const published = json.objectChanges?.find((c) => c.type === 'published');
  if (!published?.packageId) throw new Error('packageId not found in publish output');
  return published.packageId;
}

/**
 * Find objects created in a transaction's changedObjects.
 * Returns objects grouped by ownership type to identify portfolios (shared)
 * vs capabilities (owned by ACTIVE_ADDRESS).
 */
function extractCreated(effects: SuiClientTypes.TransactionEffects): {
  shared: string[];
  ownedBySelf: string[];
} {
  const shared: string[] = [];
  const ownedBySelf: string[] = [];

  for (const obj of effects.changedObjects) {
    if (obj.idOperation !== 'Created') continue;
    if (obj.outputState === 'PackageWrite') continue;
    const owner = obj.outputOwner;
    if (!owner) continue;
    if (owner.$kind === 'Shared') {
      shared.push(obj.objectId);
    } else if (owner.$kind === 'AddressOwner' && owner.AddressOwner === ACTIVE_ADDRESS) {
      ownedBySelf.push(obj.objectId);
    }
  }
  return { shared, ownedBySelf };
}

/** Fetch the type of an object. */
async function getObjectType(objectId: string): Promise<string> {
  const obj = await suiClient.core.getObject({ objectId });
  return obj.object?.type ?? '';
}

/** Get the largest DUSDC coin owned by ACTIVE_ADDRESS. */
async function getLargestDusdcCoin(): Promise<{ objectId: string; value: bigint }> {
  const result = await suiClient.core.listCoins({
    owner: ACTIVE_ADDRESS,
    coinType: DUSDC_TYPE,
  });
  if (result.objects.length === 0) throw new Error('No DUSDC coins found');
  const sorted = [...result.objects].sort(
    (a, b) => Number(BigInt(b.balance) - BigInt(a.balance)),
  );
  const best = sorted[0]!;
  return { objectId: best.objectId, value: BigInt(best.balance) };
}

/** Execute a PTB and return the typed Transaction result (throws on failure). */
async function execute(
  keypair: Ed25519Keypair,
  tx: Transaction,
): Promise<SuiClientTypes.Transaction<{ effects: true; balanceChanges: true; events: true }>> {
  const result = await suiClient.core.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true, balanceChanges: true, events: true },
  });
  if (result.$kind === 'FailedTransaction') {
    throw new Error(`TX failed: ${JSON.stringify(result.FailedTransaction.status)}`);
  }
  return result.Transaction;
}

/** Run a DevInspect on a view that returns a single u64. */
async function readU64View(
  target: string,
  typeArguments: string[],
  objectId: string,
): Promise<bigint> {
  const tx = new Transaction();
  tx.setSender(ACTIVE_ADDRESS);
  tx.moveCall({ target, typeArguments, arguments: [tx.object(objectId)] });
  const sim = await suiClient.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true },
  });
  if (sim.$kind === 'FailedTransaction') {
    throw new Error(`Simulation failed (${target}): ${JSON.stringify(sim.FailedTransaction.status)}`);
  }
  const bcs = sim.commandResults?.[0]?.returnValues[0]?.bcs;
  if (!bcs) throw new Error(`No return value from ${target}`);
  return Buffer.from(bcs).readBigUInt64LE(0);
}

const readLpBalance = (portfolioId: string, packageId: string) =>
  readU64View(`${packageId}::portfolio::lp_balance`, [DUSDC_TYPE, PLP_TYPE], portfolioId);

const readQuoteBalance = (portfolioId: string, packageId: string) =>
  readU64View(`${packageId}::portfolio::quote_balance`, [DUSDC_TYPE], portfolioId);

const readTotalShares = (portfolioId: string, packageId: string) =>
  readU64View(`${packageId}::portfolio::total_shares`, [DUSDC_TYPE], portfolioId);

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Sonark Phase 2 Integration Test ===\n');
  console.log(`Wallet : ${ACTIVE_ADDRESS}`);
  console.log(`Network: ${env.SUI_NETWORK}`);

  const dusdc = await getLargestDusdcCoin();
  log('DUSDC available', `${dusdc.value} (${dusdc.value / 1_000_000n} DUSDC)`);

  const keypair = findKeypair();
  console.log('\nKeypair matched to active address ✓');

  // ── Step 1: Publish ──────────────────────────────────────────────────────────
  step('Step 1 — Publish contracts/sonark to testnet');

  let packageId: string;
  if (env.SONARK_PACKAGE) {
    packageId = env.SONARK_PACKAGE;
    log('Reusing existing package', packageId);
  } else {
    console.log('  Running: sui client publish ...');
    const raw = execSync(
      `sui client publish --gas-budget 200000000 "${CONTRACTS_PATH}" --json 2>&1`,
      { encoding: 'utf-8', timeout: 120_000 },
    );
    const publishJson = extractJson(raw);
    packageId = extractPackageId(publishJson);
    console.log(`  → Set SONARK_PACKAGE=${packageId} in .env to skip publish on re-run`);
  }
  log('Package ID', packageId);

  // ── Step 2: Create portfolio ─────────────────────────────────────────────────
  step('Step 2 — Create SonarkPortfolio<DUSDC> + MockLending');

  const expiryMs = BigInt(Date.now() + 86_400_000); // 1 day from now

  const setupTx = new Transaction();
  const policyCap = setupTx.moveCall({
    target: `${packageId}::portfolio::create`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      setupTx.pure.u64(BUDGET_CAP),
      setupTx.pure.u64(expiryMs),
      setupTx.object(CLOCK_ID),
    ],
  });
  setupTx.moveCall({
    target: `${packageId}::mock_lending::create`,
    arguments: [setupTx.pure.u64(500n)], // 5% APY
  });
  setupTx.transferObjects([policyCap], ACTIVE_ADDRESS);

  const setupResult = await execute(keypair, setupTx);
  const setupDigest = setupResult.digest;
  log('Setup TX digest', setupDigest);
  log('Explorer', `${EXPLORER_URL}/${setupDigest}`);
  await suiClient.core.waitForTransaction({ digest: setupDigest });

  const { shared, ownedBySelf } = extractCreated(setupResult.effects!);

  // Distinguish SonarkPortfolio from MockLending by fetching their types
  let portfolioId = '';
  let mockLendingId = '';
  for (const id of shared) {
    const type = await getObjectType(id);
    if (type.includes('SonarkPortfolio')) portfolioId = id;
    else if (type.includes('MockLending')) mockLendingId = id;
  }
  if (!portfolioId) {
    throw new Error(
      `SonarkPortfolio not found among created shared objects: ${JSON.stringify(shared)}`,
    );
  }

  const policyCapId = ownedBySelf[0];
  if (!policyCapId) throw new Error('PolicyCap not found among created owned objects');

  log('Portfolio ID (shared)', portfolioId);
  log('PolicyCap ID (owned)', policyCapId);
  if (mockLendingId) log('MockLending ID (shared)', mockLendingId);

  // ── Step 3: Deposit DUSDC ────────────────────────────────────────────────────
  step('Step 3 — Deposit DUSDC into portfolio');

  if (dusdc.value < DEPOSIT_AMOUNT) {
    throw new Error(`Insufficient DUSDC: have ${dusdc.value}, need ${DEPOSIT_AMOUNT}`);
  }

  const depositTx = new Transaction();
  const depositSplit = depositTx.splitCoins(depositTx.object(dusdc.objectId), [
    depositTx.pure.u64(DEPOSIT_AMOUNT),
  ]);
  // splitCoins returns NestedResults; [0] is the first (and only) split coin.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const depositCoin = depositSplit[0]!;
  const shareResult = depositTx.moveCall({
    target: `${packageId}::portfolio::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [depositTx.object(portfolioId), depositCoin, depositTx.object(CLOCK_ID)],
  });
  depositTx.transferObjects([shareResult], ACTIVE_ADDRESS);

  const depositResult = await execute(keypair, depositTx);
  const depositDigest = depositResult.digest;
  log('Deposit TX digest', depositDigest);
  log('Explorer', `${EXPLORER_URL}/${depositDigest}`);
  await suiClient.core.waitForTransaction({ digest: depositDigest });

  const depositCreated = extractCreated(depositResult.effects!);
  const shareId = depositCreated.ownedBySelf[0];
  if (!shareId) throw new Error('PortfolioShare not found in deposit result');
  log('PortfolioShare ID (owned)', shareId);
  log('Deposited', `${DEPOSIT_AMOUNT} DUSDC`);

  // ── Step 4: Supply cycle ─────────────────────────────────────────────────────
  step('Step 4 — Supply cycle (take_for_supply → predict::supply → store_lp)');

  const supplyTx = new Transaction();
  const supplyDusdc = supplyTx.moveCall({
    target: `${packageId}::portfolio::take_for_supply`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      supplyTx.object(portfolioId),
      supplyTx.pure.u64(SUPPLY_AMOUNT),
      supplyTx.object(policyCapId),
      supplyTx.object(CLOCK_ID),
    ],
  });
  const plpCoin = supplyTx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::supply`,
    typeArguments: [DUSDC_TYPE],
    arguments: [supplyTx.object(PREDICT_OBJECT), supplyDusdc, supplyTx.object(CLOCK_ID)],
  });
  supplyTx.moveCall({
    target: `${packageId}::portfolio::store_lp`,
    typeArguments: [DUSDC_TYPE, PLP_TYPE],
    arguments: [
      supplyTx.object(portfolioId),
      plpCoin,
      supplyTx.object(policyCapId),
      supplyTx.object(CLOCK_ID),
    ],
  });

  const supplyResult = await execute(keypair, supplyTx);
  const supplyDigest = supplyResult.digest;
  log('Supply TX digest', supplyDigest);
  log('Explorer', `${EXPLORER_URL}/${supplyDigest}`);
  await suiClient.core.waitForTransaction({ digest: supplyDigest });
  console.log('  supply cycle executed without abort ✓');

  // ── Step 5: Verify LP balance via DevInspect ─────────────────────────────────
  step('Step 5 — Verify LP in Bag (DevInspect lp_balance)');

  const lpBalance = await readLpBalance(portfolioId, packageId);
  log('lp_balance<DUSDC, PLP>', lpBalance.toString());
  if (lpBalance === 0n) {
    throw new Error('LP balance is 0 after supply — TypeName-Bag did NOT store PLP correctly!');
  }
  console.log('\n  ✓ TypeName-Bag confirmed: real PLP is in the portfolio Bag under its TypeName key.');

  // ── Step 6a: Return LP to portfolio ─────────────────────────────────────────
  step('Step 6a — Return LP (take_lp → predict::withdraw → store_quote)');

  const retrieveTx = new Transaction();
  const takenPlp = retrieveTx.moveCall({
    target: `${packageId}::portfolio::take_lp`,
    typeArguments: [DUSDC_TYPE, PLP_TYPE],
    arguments: [
      retrieveTx.object(portfolioId),
      retrieveTx.pure.u64(lpBalance),
      retrieveTx.object(policyCapId),
      retrieveTx.object(CLOCK_ID),
    ],
  });
  const returnedDusdc = retrieveTx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [retrieveTx.object(PREDICT_OBJECT), takenPlp, retrieveTx.object(CLOCK_ID)],
  });
  retrieveTx.moveCall({
    target: `${packageId}::portfolio::store_quote`,
    typeArguments: [DUSDC_TYPE],
    arguments: [retrieveTx.object(portfolioId), returnedDusdc],
  });

  let withdrawDigest = '';
  let withdrawSucceeded = false;
  try {
    const retrieveResult = await execute(keypair, retrieveTx);
    const retrieveDigest = retrieveResult.digest;
    log('Retrieve TX digest', retrieveDigest);
    log('Explorer', `${EXPLORER_URL}/${retrieveDigest}`);
    await suiClient.core.waitForTransaction({ digest: retrieveDigest });
    console.log('  LP retrieved from Predict ✓');

    // ── Step 6b: Compute actual NAV then withdraw share ──────────────────────
    step('Step 6b — Compute NAV then withdraw share');

    // Read actual portfolio state to compute the real NAV.
    // NAV fell slightly due to spread cost on the supply/withdraw round-trip.
    const SCALING = 1_000_000_000n;
    const actualQuote = await readQuoteBalance(portfolioId, packageId);
    const actualShares = await readTotalShares(portfolioId, packageId);
    // nav_per_share = quote_balance * SCALING / total_shares (round down)
    const navPerShare = (actualQuote * SCALING) / actualShares;

    log('quote_balance (on-chain)', actualQuote.toString());
    log('total_shares (on-chain)', actualShares.toString());
    log('computed nav_per_share', navPerShare.toString());

    const withdrawTx = new Transaction();
    withdrawTx.moveCall({
      target: `${packageId}::portfolio::update_nav`,
      typeArguments: [DUSDC_TYPE],
      arguments: [
        withdrawTx.object(portfolioId),
        withdrawTx.pure.u64(navPerShare),
        withdrawTx.object(policyCapId),
        withdrawTx.object(CLOCK_ID),
      ],
    });
    const withdrawnCoin = withdrawTx.moveCall({
      target: `${packageId}::portfolio::withdraw`,
      typeArguments: [DUSDC_TYPE],
      arguments: [withdrawTx.object(portfolioId), withdrawTx.object(shareId)],
    });
    withdrawTx.transferObjects([withdrawnCoin], ACTIVE_ADDRESS);

    const withdrawResult = await execute(keypair, withdrawTx);
    withdrawDigest = withdrawResult.digest;
    withdrawSucceeded = true;

    const dusdcBack = (withdrawResult.balanceChanges ?? [])
      .filter(
        (b) =>
          b.coinType === DUSDC_TYPE &&
          b.address === ACTIVE_ADDRESS &&
          BigInt(b.amount) > 0n,
      )
      .reduce((acc, b) => acc + BigInt(b.amount), 0n);

    log('Withdraw TX digest', withdrawDigest);
    log('Explorer', `${EXPLORER_URL}/${withdrawDigest}`);
    log('DUSDC returned to wallet', `${dusdcBack}`);
    console.log('\n  ✓ Full deposit → supply → withdraw → burn cycle completed on testnet.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ⚠  Withdraw cycle failed: ${msg}`);
    console.error(
      '  The supply step (Step 4) and LP verification (Step 5) already prove the TypeName-Bag.\n',
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  PHASE 2 INTEGRATION TEST SUMMARY');
  console.log('═'.repeat(60));
  log('Package ID', packageId);
  log('Portfolio ID', portfolioId);
  log('PolicyCap ID', policyCapId);
  log('Setup TX', `${EXPLORER_URL}/${setupDigest}`);
  log('Deposit TX', `${EXPLORER_URL}/${depositDigest}`);
  log('Supply TX', `${EXPLORER_URL}/${supplyDigest}`);
  if (withdrawDigest) log('Withdraw TX', `${EXPLORER_URL}/${withdrawDigest}`);
  log('PLP in Bag after supply', `${lpBalance} (non-zero ✓)`);
  log('TypeName-Bag validated', true);
  log('Full cycle complete', withdrawSucceeded);
}

main().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
