/**
 * seal/purchase-and-decrypt.ts — Two-wallet copy purchase + Seal decryption flow.
 *
 * Two roles:
 *   CREATOR/OPERATOR: runs seal-encrypt-vault.ts to set seal_blob_id on-chain.
 *   COPIER/BUYER:     calls purchaseCopyAccess() → decryptVaultConfig()
 *
 * On-chain state read flow:
 *   1. Read SonarkPortfolio JSON → get seal_blob_id (Walrus blob ID UTF-8 bytes)
 *   2. Fetch encryptedObject from Walrus HTTP aggregator
 *   3. Build PTB with seal_approve_copy_purchase call (for Seal DevInspect)
 *   4. SealClient.decrypt(data, sessionKey, txBytes) → plaintext
 *
 * The buyer's CopyAccessTicket is created in purchaseCopyAccess() (committed TX).
 * The ticket object ID is needed for the decrypt PTB.
 *
 * Session keys are ephemeral. TTL = 10 min for CLI; extend for browser sessions.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SessionKey } from '@mysten/seal';
import type { SealCompatibleClient } from '@mysten/seal';
import { getSealClient } from './client.js';
import { env } from '../env.js';
import { log } from '../logger.js';

const SESSION_TTL_MIN = 10;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CopyPurchaseResult {
  ticketObjectId: string;
  txDigest: string;
}

export interface DecryptedConfig {
  name: string;
  strategies: Array<{ strategyId: string; allocationBps: number }>;
  [key: string]: unknown;
}

// ── Step 1: Purchase access ────────────────────────────────────────────────────

/**
 * Submit a PTB that pays the copy fee and issues a CopyAccessTicket to the buyer.
 *
 * @param client - SuiGrpcClient
 * @param buyerKeypair - Keypair paying the fee (must hold sufficient DUSDC)
 * @param portfolioObjectId - SonarkPortfolio shared object ID
 * @param paymentCoinObjectId - DUSDC Coin object owned by buyer with value >= copy_fee
 * @returns CopyPurchaseResult with the ticket object ID and TX digest
 */
export async function purchaseCopyAccess(
  client: SuiGrpcClient,
  buyerKeypair: Ed25519Keypair,
  portfolioObjectId: string,
  paymentCoinObjectId: string,
): Promise<CopyPurchaseResult> {
  const sonarkPkg = env.SONARK_PACKAGE;
  const dusdc = env.DUSDC_TYPE;
  const buyerAddress = buyerKeypair.getPublicKey().toSuiAddress();

  const tx = new Transaction();
  tx.setSender(buyerAddress);

  // purchase_copy_access returns the CopyAccessTicket
  const ticket = tx.moveCall({
    target: `${sonarkPkg}::portfolio::purchase_copy_access`,
    typeArguments: [dusdc],
    arguments: [
      tx.object(portfolioObjectId),
      tx.object(paymentCoinObjectId),
    ],
  });

  // Transfer ticket to buyer (CopyAccessTicket has `key` only; PTB TransferObjects works)
  tx.transferObjects([ticket], tx.pure.address(buyerAddress));

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer: buyerKeypair,
    include: { effects: true },
  });

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`purchaseCopyAccess TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction!.digest;
  await client.core.waitForTransaction({ digest });

  // Find the CopyAccessTicket in created objects via effects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const effects = result.Transaction!.effects as any;
  const created: Array<{ objectId?: string; digest?: string; version?: string }> =
    effects?.created ?? effects?.Created ?? [];

  // The ticket is the only newly created object (Coin<Q> was pre-existing)
  const ticketRef = created.find(c => c.objectId);
  if (!ticketRef?.objectId) {
    throw new Error('purchaseCopyAccess: CopyAccessTicket object not found in created objects');
  }

  const ticketObjectId = ticketRef.objectId;
  log.info({ ticketObjectId, txDigest: digest, portfolioId: portfolioObjectId },
    'CopyAccessTicket purchased');

  return { ticketObjectId, txDigest: digest };
}

// ── Step 2: Fetch encrypted blob from Walrus ───────────────────────────────────

/**
 * Fetch the encrypted config bytes from Walrus using the blob ID stored on-chain.
 * The blob ID is stored in portfolio.seal_blob_id as UTF-8 bytes; decode to string.
 */
export async function fetchEncryptedBlob(sealBlobIdBytes: number[]): Promise<Uint8Array> {
  const blobId = new TextDecoder().decode(Uint8Array.from(sealBlobIdBytes));
  const url = `${env.WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`;

  log.info({ blobId, url }, 'fetching encrypted vault config from Walrus');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Walrus fetch failed for blob ${blobId}: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// ── Step 3: Build the Seal approval PTB ───────────────────────────────────────

/**
 * Build the PTB that Seal's key servers run via DevInspect to verify access.
 *
 * The PTB calls seal_approve_copy_purchase with:
 *   - _seal_id: the portfolio object ID as raw bytes (32 bytes, no 0x prefix)
 *   - portfolio: the shared SonarkPortfolio
 *   - ticket: the buyer's CopyAccessTicket (by reference — DevInspect reads, not writes)
 *
 * @param portfolioObjectId - hex string e.g. "0x1234..."
 * @param ticketObjectId - the buyer's CopyAccessTicket object ID
 * @param buyerAddress - must match ticket.buyer (Seal DevInspect uses this as sender)
 * @param client - for tx.build()
 */
export async function buildSealApprovePtb(
  portfolioObjectId: string,
  ticketObjectId: string,
  buyerAddress: string,
  client: SuiGrpcClient,
): Promise<Uint8Array> {
  const sonarkPkg = env.SONARK_PACKAGE;
  const dusdc = env.DUSDC_TYPE;

  // Convert portfolio object ID hex to raw 32 bytes (no 0x prefix, padded to 64 hex chars)
  const idHex = portfolioObjectId.startsWith('0x')
    ? portfolioObjectId.slice(2)
    : portfolioObjectId;
  const idBytes = Array.from(Buffer.from(idHex.padStart(64, '0'), 'hex'));

  const tx = new Transaction();
  tx.setSender(buyerAddress);

  tx.moveCall({
    target: `${sonarkPkg}::portfolio::seal_approve_copy_purchase`,
    typeArguments: [dusdc],
    arguments: [
      tx.pure.vector('u8', idBytes),
      tx.object(portfolioObjectId),
      tx.object(ticketObjectId),
    ],
  });

  return await tx.build({ client: client.core });
}

// ── Step 4: Decrypt with Seal ──────────────────────────────────────────────────

/**
 * Full decrypt flow for a buyer who holds a CopyAccessTicket.
 *
 * For CLI use, the buyerKeypair signs the SessionKey personal message directly.
 * In a browser, you'd use wallet.signPersonalMessage instead of keypair.sign.
 *
 * @param client - SuiGrpcClient
 * @param buyerKeypair - Buyer's keypair (for SessionKey signing in CLI mode)
 * @param portfolioObjectId - SonarkPortfolio object ID (= Seal encryption identity)
 * @param ticketObjectId - CopyAccessTicket owned by buyer
 * @param sealBlobIdBytes - portfolio.seal_blob_id field (UTF-8 bytes of Walrus blob ID)
 * @returns Decrypted VaultConfig
 */
export async function decryptVaultConfig(
  client: SuiGrpcClient,
  buyerKeypair: Ed25519Keypair,
  portfolioObjectId: string,
  ticketObjectId: string,
  sealBlobIdBytes: number[],
): Promise<DecryptedConfig> {
  const sonarkPkg = env.SONARK_PACKAGE;
  const buyerAddress = buyerKeypair.getPublicKey().toSuiAddress();
  const sealClient = getSealClient(client);

  // ── Create ephemeral session key ─────────────────────────────────────────────
  const sessionKey = await SessionKey.create({
    address: buyerAddress,
    packageId: sonarkPkg,
    ttlMin: SESSION_TTL_MIN,
    suiClient: client as unknown as SealCompatibleClient,
  });

  // Sign the session key personal message (CLI: direct keypair sign)
  const personalMessage = sessionKey.getPersonalMessage();
  const { signature } = await buyerKeypair.signPersonalMessage(personalMessage);
  await sessionKey.setPersonalMessageSignature(signature);

  log.info({ buyerAddress, portfolioId: portfolioObjectId }, 'Seal session key created and signed');

  // ── Fetch encrypted blob from Walrus ─────────────────────────────────────────
  const encryptedBytes = await fetchEncryptedBlob(sealBlobIdBytes);

  // ── Build the Seal approval PTB ───────────────────────────────────────────────
  const txBytes = await buildSealApprovePtb(
    portfolioObjectId,
    ticketObjectId,
    buyerAddress,
    client,
  );

  // ── Decrypt via Seal ──────────────────────────────────────────────────────────
  log.info({ portfolioId: portfolioObjectId, ticketId: ticketObjectId },
    'requesting decryption key from Seal servers');

  const plaintext = await sealClient.decrypt({
    data: encryptedBytes,
    sessionKey,
    txBytes,
  });

  const configJson = new TextDecoder().decode(plaintext);
  const config = JSON.parse(configJson) as DecryptedConfig;

  log.info({ portfolioId: portfolioObjectId, configName: config.name },
    'vault config decrypted successfully');

  return config;
}
