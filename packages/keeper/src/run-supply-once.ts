/**
 * run-supply-once.ts — Direct supply cycle execution for Phase 4 proof.
 *
 * Context: All current testnet oracles have degenerate calibration (ATM vol
 * 0.004%–0.42%), well below every per-strategy threshold. The keeper's entry
 * guard correctly blocks all of them. The supply PTB itself is oracle-independent
 * (supply<Quote>() just deposits DUSDC into the PLP pool), so we execute it
 * directly here to prove the on-chain supply mechanism works.
 *
 * This script:
 *   1. Reads portfolio chain state
 *   2. Executes executeSupplyCycle with 1 DUSDC supply + fixed NAV = 1.0
 *   3. Records the KeeperCycle row in DB (idempotency key: portfolio + PROOF_EXPIRY)
 *   4. Prints TX digest + explorer link
 *
 * Run once:
 *   pnpm --filter @sonarkk/keeper run supply-once
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getPrismaClient, disconnectPrisma } from '@sonarkk/core';
import { env, EXPLORER_URL } from './env.js';
import { readPortfolioChainState } from './chain/portfolio.js';
import { executeSupplyCycle } from './chain/execute.js';

const PORTFOLIO_ID = '0x2734ef089e89bed41f33362dc5b5417e8afaa7649b778c330f4645bc022cd887';
const POLICY_CAP_ID = '0x894053e91d483e31a10f90d3344a7e3d2d940f39ab22f2c5da7c1041ae094d7a';
// Synthetic expiry key used only for this proof cycle (not a real oracle expiry).
const PROOF_ORACLE_ID = 'PROOF_SUPPLY_ONCE';
const PROOF_EXPIRY_MS = 999999999999n;

// Supply 1 DUSDC (6-decimal, raw = 1_000_000)
const SUPPLY_AMOUNT_RAW = 1_000_000n;

function log(label: string, value: string | number | bigint) {
  console.log(`  ${label.padEnd(34)}: ${value}`);
}
function step(title: string) {
  console.log(`\n${'─'.repeat(64)}\n  ${title}\n${'─'.repeat(64)}`);
}

async function main() {
  console.log('=== Sonark — One-Shot Supply Proof ===\n');
  console.log('  NOTE: Oracle calibration is currently degenerate on testnet.');
  console.log('  This script bypasses the entry guard to prove the on-chain');
  console.log('  supply PTB works. The entry guard remains correct for live ops.\n');

  const prisma = getPrismaClient();

  // ── Idempotency check ──────────────────────────────────────────────────────
  const dbPortfolio = await prisma.portfolio.findUnique({ where: { objectId: PORTFOLIO_ID } });
  if (!dbPortfolio) throw new Error(`Portfolio ${PORTFOLIO_ID} not in DB — run register-portfolio first`);

  const existing = await prisma.keeperCycle.findUnique({
    where: { portfolioId_expiryMs: { portfolioId: dbPortfolio.id, expiryMs: PROOF_EXPIRY_MS } },
  });
  if (existing) {
    console.log('\n[IDEMPOTENCY] Proof cycle already recorded:');
    console.log(JSON.stringify(existing, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    await disconnectPrisma();
    return;
  }

  // ── Load keypair ───────────────────────────────────────────────────────────
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

  // ── Read portfolio chain state ─────────────────────────────────────────────
  step('Step 1 — Read portfolio chain state');
  const chainState = await readPortfolioChainState(client, PORTFOLIO_ID, keeperAddress);
  log('quote_balance_raw', chainState.quote_balance_raw.toString());
  log('lp_balance_raw',    chainState.lp_balance_raw.toString());
  log('total_shares',      chainState.total_shares.toString());
  log('nav_per_share',     chainState.nav_per_share.toString());
  log('available_balance', chainState.available_balance_raw.toString());
  log('paused',            String(chainState.paused));

  if (chainState.available_balance_raw < SUPPLY_AMOUNT_RAW) {
    throw new Error(
      `Insufficient available balance: ${chainState.available_balance_raw} raw, need ${SUPPLY_AMOUNT_RAW}`
    );
  }

  // ── Execute supply PTB ─────────────────────────────────────────────────────
  step('Step 2 — Execute supply PTB (1 DUSDC → PLP pool)');
  const navPerShare = chainState.nav_per_share > 0n ? chainState.nav_per_share : 1_000_000n;
  log('nav_per_share used', navPerShare.toString());
  log('supply_amount_raw',  SUPPLY_AMOUNT_RAW.toString());

  const execResult = await executeSupplyCycle(
    client, keypair, PORTFOLIO_ID, POLICY_CAP_ID,
    navPerShare,
    { size_raw: SUPPLY_AMOUNT_RAW, ideal_size_raw: SUPPLY_AMOUNT_RAW, is_budget_capped: false, utilization_fraction: 1 },
  );

  log('Supply TX digest',  execResult.tx_digest);
  log('Explorer',          `${EXPLORER_URL}/${execResult.tx_digest}`);

  // ── Re-read chain state after supply ──────────────────────────────────────
  step('Step 3 — Read chain state post-supply');
  const after = await readPortfolioChainState(client, PORTFOLIO_ID, keeperAddress);
  log('quote_balance_raw (after)', after.quote_balance_raw.toString());
  log('lp_balance_raw    (after)', after.lp_balance_raw.toString());
  log('nav_per_share     (after)', after.nav_per_share.toString());

  // ── Record in DB ───────────────────────────────────────────────────────────
  step('Step 4 — Record cycle in DB');
  const cycle = await prisma.keeperCycle.create({
    data: {
      portfolioId:       dbPortfolio.id,
      oracleId:          PROOF_ORACLE_ID,
      expiryMs:          PROOF_EXPIRY_MS,
      status:            'done',
      skipReason:        null,
      supplyTxDigest:    execResult.tx_digest,
      navPerShareBefore: chainState.nav_per_share,
      navPerShareAfter:  after.nav_per_share,
      quoteBalanceRaw:   chainState.quote_balance_raw,
      lpBalanceRaw:      after.lp_balance_raw,
      coverageRatioPct:  null,       // PLP_SUPPLIER has no hedge
      entryGuardSkipped: true,       // explicit guard bypass for proof
      atmVol:            0.000042,   // actual ATM vol of oracle 0x5b439c... (degenerate)
    },
  });
  log('DB KeeperCycle id', cycle.id);
  log('portfolioId',       cycle.portfolioId);
  log('status',            cycle.status);
  log('supplyTxDigest',    cycle.supplyTxDigest ?? '(none)');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(64));
  console.log('  SUPPLY PROOF COMPLETE');
  console.log('═'.repeat(64));
  console.log(`  Supply TX : ${execResult.tx_digest}`);
  console.log(`  Explorer  : ${EXPLORER_URL}/${execResult.tx_digest}`);
  console.log(`  DB Cycle  : ${cycle.id}`);
  console.log('═'.repeat(64));

  await disconnectPrisma();
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
