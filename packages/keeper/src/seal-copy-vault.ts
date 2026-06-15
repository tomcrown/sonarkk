/**
 * seal-copy-vault.ts — Copier CLI: purchase access and decrypt a vault config.
 *
 * Two-step flow demonstrating the full Seal copy-trading purchase:
 *   1. PURCHASE: Submit PTB paying copy_fee → receive CopyAccessTicket
 *   2. DECRYPT:  Fetch encrypted blob from Walrus, create Seal SessionKey, build
 *               approval PTB, call SealClient.decrypt() → plaintext VaultConfig
 *
 * This script runs both steps using the BUYER_PRIVATE_KEY keypair.
 * In production, step 2 would be triggered from a browser wallet.
 *
 * Usage (purchase + decrypt):
 *   BUYER_PRIVATE_KEY=<base64> pnpm --filter @sonarkk/keeper tsx src/seal-copy-vault.ts \
 *     --portfolio <portfolioObjectId> \
 *     --payment <dusdc_coin_object_id>
 *
 * Usage (decrypt only, ticket already purchased):
 *   BUYER_PRIVATE_KEY=<base64> pnpm --filter @sonarkk/keeper tsx src/seal-copy-vault.ts \
 *     --portfolio <portfolioObjectId> \
 *     --ticket <ticketObjectId>
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';
import { z } from 'zod';
import { env } from './env.js';
import { log } from './logger.js';
import { purchaseCopyAccess, decryptVaultConfig } from './seal/purchase-and-decrypt.js';

// BUYER_PRIVATE_KEY: separate env var so the buyer can be a different wallet.
const buyerEnv = z.object({
  BUYER_PRIVATE_KEY: z.string().min(1, 'BUYER_PRIVATE_KEY must be set (buyer keypair)'),
}).parse(process.env);

async function main() {
  const args = process.argv.slice(2);

  const portfolioObjectId = args[args.indexOf('--portfolio') + 1];
  if (!portfolioObjectId) {
    console.error('Usage: --portfolio <portfolioObjectId> [--payment <coinId> | --ticket <ticketId>]');
    process.exit(1);
  }

  const paymentIdx = args.indexOf('--payment');
  const ticketIdx = args.indexOf('--ticket');
  const paymentCoinId = paymentIdx >= 0 ? args[paymentIdx + 1] : null;
  const existingTicketId = ticketIdx >= 0 ? args[ticketIdx + 1] : null;

  if (!paymentCoinId && !existingTicketId) {
    console.error('Provide either --payment <coinId> (to purchase) or --ticket <ticketId> (if already purchased)');
    process.exit(1);
  }

  // ── Init Sui client + buyer keypair ───────────────────────────────────────────
  const client = new SuiGrpcClient({ network: env.SUI_NETWORK as 'testnet', baseUrl: env.SUI_GRPC_URL });
  const buyerKeypair = Ed25519Keypair.fromSecretKey(fromBase64(buyerEnv.BUYER_PRIVATE_KEY));
  const buyerAddress = buyerKeypair.getPublicKey().toSuiAddress();

  log.info({ portfolioId: portfolioObjectId, buyerAddress }, 'seal-copy-vault starting');

  // ── Step 1: Read seal_blob_id from on-chain portfolio object ──────────────────
  // Use the same `(client.core as any).getObject({ objectId, include: { json: true } })` pattern.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const portfolioObj = await (client.core as any).getObject({
    objectId: portfolioObjectId,
    include: { json: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (portfolioObj?.object?.json ?? portfolioObj?.json) as Record<string, any> | undefined;
  if (!json) {
    console.error('Could not read portfolio object JSON fields');
    process.exit(1);
  }

  // seal_blob_id is Option<vector<u8>>: in JSON it appears as an array of numbers or null.
  const sealBlobIdRaw = json['seal_blob_id'] as number[] | null | undefined;
  if (!sealBlobIdRaw || sealBlobIdRaw.length === 0) {
    console.error('This portfolio has no seal_blob_id set — run seal-encrypt-vault.ts first');
    process.exit(1);
  }

  const blobId = new TextDecoder().decode(Uint8Array.from(sealBlobIdRaw));
  console.log(`\nPortfolio: ${portfolioObjectId}`);
  console.log(`Walrus blob: ${blobId}`);

  // ── Step 2: Purchase CopyAccessTicket (if not already purchased) ──────────────
  let ticketObjectId = existingTicketId ?? '';

  if (!existingTicketId) {
    console.log('\n[1/2] Purchasing CopyAccessTicket...');
    const result = await purchaseCopyAccess(
      client,
      buyerKeypair,
      portfolioObjectId,
      paymentCoinId!,
    );
    ticketObjectId = result.ticketObjectId;
    console.log(`  Purchase TX: ${result.txDigest}`);
    console.log(`  Ticket:      ${ticketObjectId}`);
    console.log('  Copy fee paid to portfolio owner.');
  } else {
    console.log(`\n[1/2] Using existing ticket: ${existingTicketId}`);
  }

  // ── Step 3: Decrypt the vault config via Seal ─────────────────────────────────
  console.log('\n[2/2] Decrypting vault config via Seal...');
  console.log('  Fetching encrypted blob from Walrus...');
  console.log('  Creating Seal session key...');

  const decryptedConfig = await decryptVaultConfig(
    client,
    buyerKeypair,
    portfolioObjectId,
    ticketObjectId,
    sealBlobIdRaw,
  );

  // ── Output ────────────────────────────────────────────────────────────────────
  console.log('\n✓ Vault config decrypted successfully\n');
  console.log('━━━━ DECRYPTED VAULT CONFIG ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(JSON.stringify(decryptedConfig, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nYou can now deploy your own portfolio with these settings using:');
  console.log('  pnpm --filter @sonarkk/keeper tsx src/deploy-vault.ts \\');
  console.log(`    --name "${String(decryptedConfig.name)} (copy)" \\`);

  const strategies = (decryptedConfig.strategies ?? []) as Array<{strategyId: string; allocationBps: number}>;
  for (const s of strategies) {
    console.log(`    --strategy ${s.strategyId} --allocations ${s.allocationBps}`);
  }
  console.log('\nNote: Copying a strategy does not guarantee the same returns.');
  console.log('Past performance is modeled and not indicative of future results.');
}

main().catch(err => {
  log.error({ err }, 'seal-copy-vault failed');
  process.exit(1);
});
