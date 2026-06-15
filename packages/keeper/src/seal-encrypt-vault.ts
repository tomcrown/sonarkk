/**
 * seal-encrypt-vault.ts — Operator CLI: encrypt a vault config and attach to portfolio.
 *
 * This script:
 *   1. Reads the vault config from DB (given a portfolio object ID)
 *   2. Encrypts it with Seal (identity = portfolioObjectId)
 *   3. Uploads encrypted bytes to Walrus → blobId
 *   4. Submits a PTB calling portfolio::set_copy_config(blobId, copy_fee)
 *
 * Usage:
 *   pnpm --filter @sonarkk/keeper tsx src/seal-encrypt-vault.ts \
 *     --portfolio <portfolioObjectId> \
 *     --copy-fee <DUSDC_units>   (e.g. 1000000 = 1 DUSDC; omit to disable copy)
 *
 * Only the portfolio owner's keypair can call set_copy_config.
 * Set KEEPER_PRIVATE_KEY to the owner's private key for this script.
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { getPrismaClient } from '@sonarkk/core';
import { env } from './env.js';
import { log } from './logger.js';
import { encryptAndUploadConfig } from './seal/encrypt-config.js';
import type { VaultConfigForCopy } from './seal/encrypt-config.js';

async function main() {
  const args = process.argv.slice(2);

  const portfolioObjectId = args[args.indexOf('--portfolio') + 1];
  if (!portfolioObjectId) {
    console.error('Usage: --portfolio <portfolioObjectId> [--copy-fee <DUSDC_units>]');
    process.exit(1);
  }

  const copyFeeIdx = args.indexOf('--copy-fee');
  const copyFee = copyFeeIdx >= 0 ? BigInt(args[copyFeeIdx + 1]!) : null;

  // ── Init Sui client + keypair ─────────────────────────────────────────────────
  const client = new SuiGrpcClient({ network: env.SUI_NETWORK as 'testnet', baseUrl: env.SUI_GRPC_URL });
  const keypair = Ed25519Keypair.fromSecretKey(fromBase64(env.KEEPER_PRIVATE_KEY));
  const ownerAddress = keypair.getPublicKey().toSuiAddress();

  log.info(
    { portfolioId: portfolioObjectId, copyFee: copyFee?.toString() ?? 'disabled', ownerAddress },
    'seal-encrypt-vault starting',
  );

  // ── Load portfolio config from DB ─────────────────────────────────────────────
  const prisma = getPrismaClient();

  const portfolio = await prisma.portfolio.findFirst({
    where: { objectId: portfolioObjectId },
    include: { vaultConfig: true },
  });

  if (!portfolio) {
    console.error(`No portfolio found with objectId ${portfolioObjectId}`);
    process.exit(1);
  }

  // Build the config object using spread to satisfy exactOptionalPropertyTypes.
  const baseConfig = {
    name: portfolio.vaultConfig?.name ?? portfolio.strategy,
    strategies: [{ strategyId: portfolio.strategy, allocationBps: 10000 }],
  };
  const optionalConfig: Partial<VaultConfigForCopy> = {
    ...(portfolio.utilTarget != null ? { utilTarget: portfolio.utilTarget } : {}),
    ...(portfolio.volTargetBps != null ? { volTargetBps: portfolio.volTargetBps } : {}),
    ...(portfolio.minAtmVolOverride != null ? { minAtmVolOverride: portfolio.minAtmVolOverride } : {}),
    ...(portfolio.strikeSelection ? { strikeSelection: portfolio.strikeSelection } : {}),
    ...(portfolio.liquidityReservePct != null ? { liquidityReservePct: portfolio.liquidityReservePct } : {}),
    ...(portfolio.drawdownPauseThresholdPct != null
      ? { drawdownPauseThresholdPct: portfolio.drawdownPauseThresholdPct }
      : {}),
    ...(portfolio.vaultConfig?.budgetCapPerCycleRaw != null
      ? { budgetCapPerCycleUsd: Number(portfolio.vaultConfig.budgetCapPerCycleRaw) / 1_000_000 }
      : {}),
  };
  const vaultConfig: VaultConfigForCopy = { ...baseConfig, ...optionalConfig };

  // ── Encrypt and upload ────────────────────────────────────────────────────────
  const { blobId } = await encryptAndUploadConfig(client, keypair, portfolioObjectId, vaultConfig);

  const blobIdBytes = Array.from(new TextEncoder().encode(blobId));

  // ── Set copy config on-chain ──────────────────────────────────────────────────
  const tx = new Transaction();
  tx.setSender(ownerAddress);

  tx.moveCall({
    target: `${env.SONARK_PACKAGE}::portfolio::set_copy_config`,
    typeArguments: [env.DUSDC_TYPE],
    arguments: [
      tx.object(portfolioObjectId),
      tx.pure.vector('u8', blobIdBytes),
      copyFee !== null
        ? tx.pure.option('u64', copyFee)
        : tx.pure.option('u64', null),
    ],
  });

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true },
  });

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`set_copy_config TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction!.digest;
  await client.core.waitForTransaction({ digest });

  // ── Update DB: sealBlobId lives on VaultConfig ────────────────────────────────
  if (portfolio.vaultConfigId) {
    await prisma.vaultConfig.update({
      where: { id: portfolio.vaultConfigId },
      data: { sealBlobId: blobId },
    });
  }

  console.log('\n✓ Vault config encrypted and attached to portfolio');
  console.log(`  Portfolio:   ${portfolioObjectId}`);
  console.log(`  Walrus blob: ${blobId}`);
  console.log(`  Copy fee:    ${copyFee !== null ? `${copyFee} DUSDC units` : 'disabled (private)'}`);
  console.log(`  Set TX:      ${digest}`);
  console.log('\nCopiers can now purchase access using:');
  console.log('  BUYER_PRIVATE_KEY=<key> pnpm --filter @sonarkk/keeper tsx src/seal-copy-vault.ts \\');
  console.log(`    --portfolio ${portfolioObjectId} --payment <coin_object_id>`);
}

main().catch(err => {
  log.error({ err }, 'seal-encrypt-vault failed');
  process.exit(1);
});
