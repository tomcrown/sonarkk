/**
 * register-portfolio.ts — DB-only registration for an already-deployed portfolio.
 *
 * Use this when the on-chain portfolio already exists but the DB row is missing
 * (e.g. the deploy-portfolio script failed at the DB step after on-chain success).
 *
 * Set these env vars before running:
 *   SONARK_PORTFOLIO_ID=0x...
 *   SONARK_POLICY_CAP_ID=0x...
 *   PORTFOLIO_STRATEGY=PLP_SUPPLIER   (default: PLP_SUPPLIER)
 *
 *   pnpm --filter @sonarkk/keeper run register-portfolio
 */

import 'dotenv/config';
import { getPrismaClient, disconnectPrisma } from '@sonarkk/core';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { env } from './env.js';

const portfolioId = process.env['SONARK_PORTFOLIO_ID'];
const policyCapId  = process.env['SONARK_POLICY_CAP_ID'];
const strategy     = process.env['PORTFOLIO_STRATEGY'] ?? 'PLP_SUPPLIER';

if (!portfolioId || !policyCapId) {
  console.error('[FATAL] SONARK_PORTFOLIO_ID and SONARK_POLICY_CAP_ID must be set');
  process.exit(1);
}

let keypair: Ed25519Keypair;
try {
  keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
} catch {
  const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
  keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
}
const ownerAddress = keypair.getPublicKey().toSuiAddress();

const prisma = getPrismaClient();
const record = await prisma.portfolio.upsert({
  where: { objectId: portfolioId },
  create: { objectId: portfolioId, ownerAddress, policyCapId, strategy, isActive: true, hedgeMultiplier: 1.0 },
  update: { policyCapId, isActive: true },
});

console.log('Portfolio registered in DB:');
console.log(JSON.stringify(record, null, 2));

await disconnectPrisma();
