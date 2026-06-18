/**
 * seal.ts — Browser-side Seal encrypt / decrypt utilities.
 *
 * Encrypt flow (deploy time, VaultConfigModal):
 *   1. sealClient.encrypt({ threshold:1, packageId, id: portfolio1ObjectId, data })
 *   2. PUT encryptedBytes to Walrus HTTP publisher → blobId string
 *   3. Caller calls portfolio::set_copy_config on-chain with blobIdBytes + copyFee
 *
 * Decrypt flow (copy time, CopyTradingModal):
 *   1. Buyer already holds a CopyAccessTicket (purchased via purchase_copy_access)
 *   2. SessionKey.create → sign personal message via wallet signPersonalMessage
 *   3. Fetch encrypted bytes from Walrus aggregator
 *   4. Build seal_approve_copy_purchase DevInspect PTB
 *   5. sealClient.decrypt → plaintext JSON config
 */

import { SealClient, SessionKey } from '@mysten/seal'
import type { SealCompatibleClient } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'

const SEAL_THRESHOLD = 1   // 1-of-N: any single key server can grant decryption
const SESSION_TTL_MIN = 10 // ephemeral session key lifetime in minutes
const WALRUS_EPOCHS = 200  // blob storage duration on Walrus testnet

// ── SealClient factory ────────────────────────────────────────────────────────
// The suiClient from useSuiClient() (dapp-kit) works as SealCompatibleClient at runtime.

function buildSealClient(suiClient: object, keyServerIds: string[]): SealClient {
  return new SealClient({
    suiClient: suiClient as unknown as SealCompatibleClient,
    serverConfigs: keyServerIds.map(objectId => ({ objectId, weight: 1 })),
    verifyKeyServers: false, // skip on testnet to avoid TLS certificate issues
  })
}

// ── Walrus HTTP publisher ─────────────────────────────────────────────────────

interface WalrusPublisherResponse {
  newlyCreated?: { blobObject: { blobId: string } }
  alreadyCertified?: { blobId: string }
}

async function uploadToWalrus(publisherUrl: string, data: Uint8Array): Promise<string> {
  const url = `${publisherUrl}/v1/blobs?epochs=${WALRUS_EPOCHS}`
  const response = await fetch(url, {
    method: 'PUT',
    // Cast required because older TS DOM lib types BodyInit without Uint8Array
    body: data as unknown as BodyInit,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error')
    throw new Error(`Walrus publisher error ${response.status}: ${text}`)
  }
  const json = await response.json() as WalrusPublisherResponse
  const blobId = json.newlyCreated?.blobObject.blobId ?? json.alreadyCertified?.blobId
  if (!blobId) {
    throw new Error(`Walrus publisher returned unexpected response: ${JSON.stringify(json)}`)
  }
  return blobId
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SealVaultConfig {
  name: string
  allocations: Array<{
    strategy: string
    strategyType: number
    allocationBps: number
    utilTarget: number
    strikeSelection: string
    liquidityReservePct: number
    drawdownPauseThresholdPct: number | null
    volTargetBps: number | null
    hedgeMultiplier: number
  }>
}

export interface DecryptedVaultConfig {
  name: string
  allocations: SealVaultConfig['allocations']
}

// ── Hex → bytes (browser-compatible, no Buffer dependency) ───────────────────

function hexToBytes(hex: string): number[] {
  const padded = hex.padStart(64, '0')
  const bytes: number[] = []
  for (let i = 0; i < 32; i++) {
    bytes.push(parseInt(padded.slice(i * 2, i * 2 + 2), 16))
  }
  return bytes
}

// ── Encrypt + upload ──────────────────────────────────────────────────────────

/**
 * Encrypt a vault config with Seal and upload the ciphertext to Walrus.
 *
 * Returns the Walrus blob ID string and the UTF-8 bytes of that string
 * (ready to pass to portfolio::set_copy_config as vector<u8>).
 */
export async function encryptAndUpload(
  suiClient: object,
  keyServerIds: string[],
  packageId: string,
  portfolioObjectId: string,
  config: SealVaultConfig,
  publisherUrl: string,
): Promise<{ blobId: string; blobIdBytes: number[] }> {
  const sealClient = buildSealClient(suiClient, keyServerIds)
  const configBytes = new TextEncoder().encode(JSON.stringify(config))

  const { encryptedObject } = await sealClient.encrypt({
    threshold: SEAL_THRESHOLD,
    packageId,
    id: portfolioObjectId,
    data: configBytes,
  })

  const blobId = await uploadToWalrus(publisherUrl, encryptedObject)
  const blobIdBytes = Array.from(new TextEncoder().encode(blobId))
  return { blobId, blobIdBytes }
}

// ── Build Seal approval PTB ───────────────────────────────────────────────────

async function buildSealApprovePtb(
  suiClient: object,
  packageId: string,
  dusdcType: string,
  portfolioObjectId: string,
  ticketObjectId: string,
  buyerAddress: string,
): Promise<Uint8Array> {
  const idHex = portfolioObjectId.startsWith('0x')
    ? portfolioObjectId.slice(2)
    : portfolioObjectId
  const idBytes = hexToBytes(idHex)

  const tx = new Transaction()
  tx.setSender(buyerAddress)
  tx.moveCall({
    target: `${packageId}::portfolio::seal_approve_copy_purchase`,
    typeArguments: [dusdcType],
    arguments: [
      tx.pure.vector('u8', idBytes),
      tx.object(portfolioObjectId),
      tx.object(ticketObjectId),
    ],
  })

  // tx.build() accepts a `client` option at runtime but the type may not declare it
  // in @mysten/sui v2.17; casting through unknown is safe — the runtime works correctly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (tx as any).build({ client: suiClient })
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

/**
 * Full browser-based Seal decrypt flow.
 *
 * @param signPersonalMessage - from dapp-kit's useSignPersonalMessage
 */
export async function decryptVaultConfig(
  suiClient: object,
  keyServerIds: string[],
  packageId: string,
  dusdcType: string,
  portfolioObjectId: string,
  ticketObjectId: string,
  blobId: string,
  buyerAddress: string,
  aggregatorUrl: string,
  signPersonalMessage: (input: { message: Uint8Array }) => Promise<{ signature: string }>,
): Promise<DecryptedVaultConfig> {
  const sealClient = buildSealClient(suiClient, keyServerIds)

  const sessionKey = await SessionKey.create({
    address: buyerAddress,
    packageId,
    ttlMin: SESSION_TTL_MIN,
    suiClient: suiClient as unknown as SealCompatibleClient,
  })

  const personalMessage = sessionKey.getPersonalMessage()
  const { signature } = await signPersonalMessage({ message: personalMessage })
  await sessionKey.setPersonalMessageSignature(signature)

  const blobResponse = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}`)
  if (!blobResponse.ok) {
    throw new Error(`Walrus aggregator error ${blobResponse.status} fetching blob ${blobId}`)
  }
  const encryptedBytes = new Uint8Array(await blobResponse.arrayBuffer())

  const txBytes = await buildSealApprovePtb(
    suiClient,
    packageId,
    dusdcType,
    portfolioObjectId,
    ticketObjectId,
    buyerAddress,
  )

  const plaintext = await sealClient.decrypt({
    data: encryptedBytes,
    sessionKey,
    txBytes,
  })

  return JSON.parse(new TextDecoder().decode(plaintext)) as DecryptedVaultConfig
}
