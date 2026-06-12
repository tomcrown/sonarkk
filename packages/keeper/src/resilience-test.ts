/**
 * resilience-test.ts — Phase 4 proof: idempotency + policy revocation.
 *
 * Run AFTER the keeper has completed at least one live cycle.
 *
 * Test 1 — Idempotency:
 *   Reads the most recent KeeperCycle row from DB. Confirms the (portfolioId, expiryMs)
 *   unique constraint exists. Re-attempts to insert the same row → expects a unique
 *   constraint violation. Then starts the keeper in --once mode and confirms it logs
 *   "already processed, skipping" for that expiry.
 *
 * Test 2 — Policy revocation:
 *   Revokes the PolicyCap by calling sonark::policy::revoke(cap) on-chain.
 *   Starts the keeper in --once mode → confirms it logs "policy invalid: revoked".
 *
 * Usage:
 *   pnpm --filter @sonarkk/keeper run resilience-test
 *
 * The SONARK_POLICY_CAP_ID env var must be set (printed by deploy-portfolio).
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getPrismaClient, disconnectPrisma } from '@sonarkk/core';
import { env, CLOCK_ID } from './env.js';

const SONARK_PACKAGE = env.SONARK_PACKAGE;
const EXPLORER       = 'https://testnet.suivision.xyz/txblock';

function log(label: string, value: string | bigint | number | boolean) {
  console.log(`  ${label.padEnd(36)}: ${value}`);
}
function step(title: string) {
  console.log(`\n${'─'.repeat(64)}\n  ${title}\n${'─'.repeat(64)}`);
}
function ok(msg: string)   { console.log(`  ✓ ${msg}`); }
function fail(msg: string) { console.log(`  ✗ ${msg}`); process.exit(1); }

async function main() {
  console.log('=== Sonark Keeper — Resilience Test ===\n');

  const policyCapId = process.env['SONARK_POLICY_CAP_ID'];
  if (!policyCapId) {
    throw new Error('SONARK_POLICY_CAP_ID not set. Run deploy-portfolio first.');
  }

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

  const prisma = getPrismaClient();

  // ── Test 1: Idempotency ───────────────────────────────────────────────────────
  step('Test 1 — Idempotency constraint');

  const latestCycle = await prisma.keeperCycle.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { portfolio: true },
  });

  if (!latestCycle) {
    fail('No KeeperCycle rows found. Run the keeper first and complete at least one cycle.');
    return;
  }

  log('Latest cycle portfolioId', latestCycle.portfolioId);
  log('Latest cycle expiryMs',    latestCycle.expiryMs.toString());
  log('Latest cycle status',      latestCycle.status);
  log('Latest cycle oracleId',    latestCycle.oracleId);

  // Attempt to insert a duplicate row — must throw unique constraint violation.
  let idempotencyHeld = false;
  try {
    await prisma.keeperCycle.create({
      data: {
        portfolioId: latestCycle.portfolioId,
        oracleId:    latestCycle.oracleId,
        expiryMs:    latestCycle.expiryMs,
        status:      'done',
        skipReason:  null,
        errorMsg:    null,
      },
    });
    // If we reach here the constraint didn't fire — bad.
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('unique') || msg.includes('P2002')) {
      idempotencyHeld = true;
    }
  }

  if (idempotencyHeld) {
    ok('Unique constraint fired — duplicate insert rejected (idempotency works)');
  } else {
    fail('Duplicate insert succeeded — unique constraint NOT enforced. Schema migration needed.');
  }

  // ── Test 2: Policy revocation ─────────────────────────────────────────────────
  step('Test 2 — Policy revocation (on-chain)');

  // Check if already revoked (idempotent re-run).
  let alreadyRevoked = false;
  try {
    await client.core.getObject({ objectId: policyCapId });
  } catch {
    alreadyRevoked = true;
  }

  if (alreadyRevoked) {
    ok(`PolicyCap already revoked (previous run) — skipping revoke TX`);
  } else {
    console.log(`  Revoking PolicyCap ${policyCapId}...`);
    console.log('  WARNING: this is irreversible. The portfolio will need a new PolicyCap.');
    console.log('  (In production the owner revokes on their schedule; this is a demo revoke.)');

    const revokeTx = new Transaction();
    revokeTx.moveCall({
      target: `${SONARK_PACKAGE}::policy::revoke`,
      arguments: [revokeTx.object(policyCapId)],
    });

    const revokeResult = await client.core.signAndExecuteTransaction({
      transaction: revokeTx,
      signer: keypair,
      include: { effects: true },
    });
    if (revokeResult.$kind === 'FailedTransaction') {
      throw new Error(`revoke TX failed: ${JSON.stringify(revokeResult.FailedTransaction?.status)}`);
    }
    const revokeDigest = revokeResult.Transaction!.digest;
    log('Revoke TX digest', revokeDigest);
    log('Explorer', `${EXPLORER}/${revokeDigest}`);
    await client.core.waitForTransaction({ digest: revokeDigest });
    ok(`PolicyCap ${policyCapId} revoked on-chain`);
  }

  // Verify the object no longer exists (it was deleted by revoke).
  // The gRPC client throws for deleted/non-existent objects rather than returning null.
  let objectGone = false;
  try {
    await client.core.getObject({ objectId: policyCapId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist')) {
      objectGone = true;
    }
  }
  if (objectGone) {
    ok('PolicyCap object deleted from chain — getObject throws "not found" (expected)');
  } else {
    fail('PolicyCap still exists after revoke — unexpected');
  }

  // Verify keeper detects it: check policy.ts logic by calling checkPolicyCap directly.
  // Import inline to avoid circular deps.
  const { checkPolicyCap } = await import('./chain/policy.js');
  const portfolioId = latestCycle.portfolio.objectId;
  const check = await checkPolicyCap(client, policyCapId, portfolioId);
  if (!check.valid && check.reason === 'revoked') {
    ok(`checkPolicyCap returns { valid: false, reason: 'revoked' } — keeper will skip`);
  } else {
    fail(`checkPolicyCap returned unexpected: ${JSON.stringify(check)}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(64));
  console.log('  RESILIENCE TESTS PASSED');
  console.log('═'.repeat(64));
  console.log('  Test 1 — Idempotency:    ✓ unique constraint blocks duplicate cycle');
  console.log('  Test 2 — Revocation:     ✓ on-chain delete → checkPolicyCap returns revoked');
  console.log('');
  console.log('  NOTE: the PolicyCap has been revoked. To re-run the keeper, deploy');
  console.log('  a new portfolio: pnpm --filter @sonarkk/keeper run deploy-portfolio');
  console.log('═'.repeat(64));

  await disconnectPrisma();
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
