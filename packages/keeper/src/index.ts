/**
 * Sonark Keeper — entry point.
 *
 * Usage:
 *   pnpm --filter @sonarkk/keeper start
 *
 * Required env vars (see .env.example):
 *   KEEPER_PRIVATE_KEY     — Ed25519 private key (bech32 or hex)
 *   SONARK_PACKAGE         — deployed Sonark package ID
 *   DATABASE_URL           — Postgres connection string
 *   DEEPBOOK_BALANCE_MANAGER — pre-created BalanceManager (run setup first)
 *
 * Kill switch:
 *   KEEPER_PAUSED=true     — halts the loop at the next poll tick
 */

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { disconnectPrisma } from '@sonarkk/core';
import { env } from './env.js';
import { log } from './logger.js';
import { runPollingLoop } from './loop.js';

async function main() {
  log.info({ network: env.SUI_NETWORK, sonarkPackage: env.SONARK_PACKAGE }, 'sonark keeper starting');

  // Load keeper keypair from env.
  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    // Fallback: treat as base64 encoded secret key bytes.
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1)); // strip scheme byte
  }

  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  log.info({ keeperAddress }, 'keeper address loaded');

  const client = new SuiGrpcClient({
    network: env.SUI_NETWORK as 'testnet',
    baseUrl: env.SUI_GRPC_URL,
  });

  // Sanity check: confirm we can reach the chain.
  const gasPrice = await client.getReferenceGasPrice();
  log.info({ gasPrice: gasPrice.referenceGasPrice }, 'chain reachable');

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'keeper shutting down');
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT',  () => { void shutdown('SIGINT');  });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  // Start the polling loop — runs forever (returns never).
  await runPollingLoop(client, keypair);
}

main().catch((err) => {
  log.error({ err }, '[FATAL] keeper crashed');
  process.exit(1);
});
