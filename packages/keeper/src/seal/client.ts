/**
 * seal/client.ts — SealClient factory for Sonark.
 *
 * Builds a SealClient using the key server IDs from SEAL_KEY_SERVER_IDS env var.
 * Uses threshold=1 (any single key server can grant decryption) which is appropriate
 * for testnet. On mainnet you would use threshold=2 or higher for security.
 *
 * Key servers are auto-fetched from on-chain state (name, URL, public key).
 * The SuiGrpcClient is a compatible SealCompatibleClient (has `core: CoreClient`).
 */

import { SealClient } from '@mysten/seal';
import type { SealCompatibleClient } from '@mysten/seal';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { env } from '../env.js';
import { log } from '../logger.js';

export const SEAL_THRESHOLD = 1; // 1-of-N: any one key server can grant decryption

let _sealClient: SealClient | null = null;

/**
 * Returns a shared SealClient instance (created on first call).
 * The client fetches key server info from chain once and caches it.
 */
export function getSealClient(suiClient: SuiGrpcClient): SealClient {
  if (_sealClient) return _sealClient;

  const serverIds = env.SEAL_KEY_SERVER_IDS
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (serverIds.length === 0) {
    throw new Error('SEAL_KEY_SERVER_IDS env var is empty — set at least one Seal key server ID');
  }

  const serverConfigs = serverIds.map(objectId => ({ objectId, weight: 1 }));

  log.info({ serverCount: serverIds.length, threshold: SEAL_THRESHOLD }, 'initializing Seal client');

  _sealClient = new SealClient({
    suiClient: suiClient as unknown as SealCompatibleClient,
    serverConfigs,
    verifyKeyServers: false, // skip on testnet to avoid cert issues
  });

  return _sealClient;
}
