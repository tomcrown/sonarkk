/**
 * seal/encrypt-config.ts — Encrypt a vault config with Seal and upload to Walrus.
 *
 * Flow:
 *   1. JSON-serialize the VaultConfig
 *   2. Encrypt with SealClient under (packageId=SONARK_PKG, id=portfolioObjectId)
 *   3. Upload encrypted bytes to Walrus → get blobId
 *   4. Return blobId (caller stores it on-chain via set_copy_config)
 *
 * The encryption identity is the portfolio's Sui object ID. Only callers who can
 * satisfy seal_approve_copy_purchase (i.e., hold a CopyAccessTicket) can decrypt.
 *
 * Security: The encryptedObject bytes are public on Walrus; only the Seal key
 * protects the plaintext. The key is only released by Seal servers after verifying
 * that seal_approve_copy_purchase does not abort for the requesting caller.
 */

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { walrus } from '@mysten/walrus';
import { getSealClient, SEAL_THRESHOLD } from './client.js';
import { env } from '../env.js';
import { log } from '../logger.js';

// Store encrypted vault config blobs for 365 Walrus epochs (1 year on testnet).
const SEAL_BLOB_EPOCHS = 365;

export interface VaultConfigForCopy {
  name: string;
  strategies: Array<{ strategyId: string; allocationBps: number }>;
  utilTarget?: number;
  volTargetBps?: number;
  minAtmVolOverride?: number;
  strikeSelection?: string;
  liquidityReservePct?: number;
  drawdownPauseThresholdPct?: number;
  hedgeMultiplier?: number;
  budgetCapPerCycleUsd?: number;
}

export interface EncryptResult {
  blobId: string;
  encryptedBytes: Uint8Array;
  suiEventDigest: string;
}

/**
 * Encrypt a vault config and upload to Walrus.
 *
 * @param client - SuiGrpcClient (used for both Walrus and Seal)
 * @param keypair - Keeper keypair (pays for Walrus storage)
 * @param portfolioObjectId - The Sui object ID of the SonarkPortfolio (used as Seal identity)
 * @param vaultConfig - The config to encrypt
 * @returns blobId (store this on-chain via portfolio::set_copy_config)
 */
export async function encryptAndUploadConfig(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioObjectId: string,
  vaultConfig: VaultConfigForCopy,
): Promise<EncryptResult> {
  const sonarkPkg = env.SONARK_PACKAGE;
  const sealClient = getSealClient(client);

  // ── Step 1: Serialize config ─────────────────────────────────────────────────
  const configJson = JSON.stringify(vaultConfig);
  const configBytes = new TextEncoder().encode(configJson);

  log.info(
    { portfolioId: portfolioObjectId, configSize: configBytes.length },
    'encrypting vault config with Seal',
  );

  // ── Step 2: Encrypt with Seal ────────────────────────────────────────────────
  // Identity = portfolioObjectId (hex string). Seal binds the ciphertext to
  // (packageId, id) so the approval function in SONARK_PACKAGE must gate decryption.
  const { encryptedObject } = await sealClient.encrypt({
    threshold: SEAL_THRESHOLD,
    packageId: sonarkPkg,
    id: portfolioObjectId,
    data: configBytes,
  });

  log.info(
    { portfolioId: portfolioObjectId, encryptedSize: encryptedObject.length },
    'Seal encryption complete — uploading to Walrus',
  );

  // ── Step 3: Upload encrypted bytes to Walrus ─────────────────────────────────
  const walrusClient = (client as any).core.$extend(walrus());
  const keeperAddress = keypair.getPublicKey().toSuiAddress();

  const flow = walrusClient.walrus.writeBlobFlow({ blob: encryptedObject });

  // Encode (content-addressed; blobId = SHA-256 of content)
  const encoded = await flow.encode();
  const blobId = encoded.blobId as string;

  // Register on-chain
  const registered = await flow.executeRegister({
    signer: keypair,
    epochs: SEAL_BLOB_EPOCHS,
    deletable: false,
    owner: keeperAddress,
  });
  const suiEventDigest = registered.txDigest as string;

  log.info({ blobId, registerTx: suiEventDigest }, 'Walrus blob registered');

  // Upload to storage nodes
  await flow.upload({ digest: suiEventDigest });

  // Certify on-chain
  await flow.executeCertify({ signer: keypair });

  log.info(
    { portfolioId: portfolioObjectId, blobId, suiEventDigest },
    'vault config encrypted and uploaded to Walrus — set this blobId on-chain',
  );

  return { blobId, encryptedBytes: encryptedObject, suiEventDigest };
}
