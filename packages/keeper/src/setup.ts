/**
 * Keeper setup script — run ONCE before starting the keeper.
 *
 * Creates:
 *   1. A DeepBook BalanceManager for hedge order placement.
 *      → Copy the printed address into .env as DEEPBOOK_BALANCE_MANAGER.
 *
 * Usage:
 *   pnpm --filter @sonarkk/keeper run setup
 *
 * Prerequisites:
 *   - KEEPER_PRIVATE_KEY set in .env
 *   - Keeper wallet funded with SUI (for gas) and DBUSDC (for hedge orders)
 *
 * After setup:
 *   Set DEEPBOOK_BALANCE_MANAGER=<printed address> in .env, then start the keeper.
 */

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient, testnetCoins, testnetPools } from '@mysten/deepbook-v3';
import { env } from './env.js';
import { log } from './logger.js';

async function main() {
  console.log('=== Sonark Keeper Setup ===\n');

  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  }

  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  console.log(`Keeper address: ${keeperAddress}`);

  const client = new SuiGrpcClient({
    network: env.SUI_NETWORK as 'testnet',
    baseUrl: env.SUI_GRPC_URL,
  });

  // Check existing BalanceManager.
  if (env.DEEPBOOK_BALANCE_MANAGER) {
    console.log(`\nDEEPBOOK_BALANCE_MANAGER already set: ${env.DEEPBOOK_BALANCE_MANAGER}`);
    console.log('Setup complete — nothing to do.');
    return;
  }

  const dbClient = new DeepBookClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    network: 'testnet',
    address: keeperAddress,
    coins: testnetCoins,
    pools: testnetPools,
  });

  console.log('\n--- Creating DeepBook BalanceManager ---');

  const tx = new Transaction();
  dbClient.balanceManager.createAndShareBalanceManager()(tx);

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true },
  });

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`createBalanceManager TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const txResult = result.Transaction!;
  await client.core.waitForTransaction({ digest: txResult.digest });

  // Find the created shared BalanceManager object.
  const createdShared = txResult.effects?.changedObjects?.filter(
    (o) =>
      o.idOperation === 'Created' &&
      o.outputOwner?.$kind === 'Shared',
  ) ?? [];

  if (createdShared.length === 0) {
    throw new Error('No shared object created in BalanceManager TX — check the TX effects');
  }

  const managerAddress = createdShared[0]!.objectId;
  const EXPLORER = 'https://testnet.suivision.xyz/txblock';

  console.log(`\n✓ BalanceManager created`);
  console.log(`  TX digest: ${txResult.digest}`);
  console.log(`  Explorer:  ${EXPLORER}/${txResult.digest}`);
  console.log(`  Address:   ${managerAddress}`);
  console.log('\n=== ACTION REQUIRED ===');
  console.log(`Add to .env:\n  DEEPBOOK_BALANCE_MANAGER=${managerAddress}`);
  console.log('\nThen fund the keeper wallet with DBUSDC for hedge orders.');
  console.log('On testnet, use the DeepBook faucet or mint DBUSDC directly.');
  console.log('\nSetup complete.');
}

main().catch((err) => {
  log.error({ err }, 'setup failed');
  process.exit(1);
});
