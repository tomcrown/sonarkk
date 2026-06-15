/**
 * Keeper setup script — run ONCE before starting the keeper.
 *
 * Creates (only if not already set in .env):
 *   1. A DeepBook BalanceManager for hedge order placement.
 *      → Copy the printed address into .env as DEEPBOOK_BALANCE_MANAGER.
 *   2. A MockMargin shared object for strategy ⑧ MARGIN_LOOP.
 *      → Copy the printed address into .env as MOCK_MARGIN_ID.
 *
 * Usage:
 *   pnpm --filter @sonarkk/keeper run setup
 *
 * Prerequisites:
 *   - KEEPER_PRIVATE_KEY set in .env
 *   - SONARK_PACKAGE set in .env (run deploy-all-strategies.ts first)
 *   - Keeper wallet funded with SUI (for gas) and DBUSDC (for hedge orders)
 *
 * After setup:
 *   Set the printed env vars in .env, then start the keeper.
 */

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient, testnetCoins, testnetPools } from '@mysten/deepbook-v3';
import { env } from './env.js';
import { log } from './logger.js';

const EXPLORER = 'https://testnet.suivision.xyz/txblock';

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

  const needsBalanceManager = !env.DEEPBOOK_BALANCE_MANAGER;
  const needsMockMargin = !env.MOCK_MARGIN_ID;

  if (!needsBalanceManager && !needsMockMargin) {
    console.log('\nAll required objects already configured:');
    console.log(`  DEEPBOOK_BALANCE_MANAGER = ${env.DEEPBOOK_BALANCE_MANAGER}`);
    console.log(`  MOCK_MARGIN_ID           = ${env.MOCK_MARGIN_ID}`);
    console.log('\nSetup complete — nothing to do.');
    return;
  }

  const envLines: string[] = [];

  // ── Step 1: DeepBook BalanceManager ─────────────────────────────────────────

  if (needsBalanceManager) {
    console.log('\n--- Creating DeepBook BalanceManager ---');

    const dbClient = new DeepBookClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      network: 'testnet',
      address: keeperAddress,
      coins: testnetCoins,
      pools: testnetPools,
    });

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

    const createdShared = txResult.effects?.changedObjects?.filter(
      (o) => o.idOperation === 'Created' && o.outputOwner?.$kind === 'Shared',
    ) ?? [];

    if (createdShared.length === 0) {
      throw new Error('No shared object created in BalanceManager TX — check the TX effects');
    }

    const managerAddress = createdShared[0]!.objectId;
    console.log(`✓ BalanceManager created: ${managerAddress}`);
    console.log(`  TX: ${EXPLORER}/${txResult.digest}`);
    envLines.push(`DEEPBOOK_BALANCE_MANAGER=${managerAddress}`);
  } else {
    console.log(`\n✓ BalanceManager already set: ${env.DEEPBOOK_BALANCE_MANAGER}`);
  }

  // ── Step 2: MockMargin ────────────────────────────────────────────────────────

  if (needsMockMargin) {
    console.log('\n--- Creating MockMargin (strategy ⑧ MARGIN_LOOP) ---');

    if (!env.SONARK_PACKAGE) {
      console.warn('  SONARK_PACKAGE not set — skipping MockMargin creation. Run deploy-all-strategies.ts first.');
    } else {
      // LTV = 75% (7500 bps), borrow rate = 8% APY (800 bps).
      const tx = new Transaction();
      tx.moveCall({
        target: `${env.SONARK_PACKAGE}::mock_margin::create`,
        typeArguments: [],
        arguments: [
          tx.pure.u64(7500n),  // ltv_bps: 75%
          tx.pure.u64(800n),   // borrow_rate_bps: 8% APY
        ],
      });

      const result = await client.core.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        include: { effects: true },
      });

      if (result.$kind === 'FailedTransaction') {
        throw new Error(`create MockMargin TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
      }

      const txResult = result.Transaction!;
      await client.core.waitForTransaction({ digest: txResult.digest });

      const createdShared = txResult.effects?.changedObjects?.filter(
        (o) => o.idOperation === 'Created' && o.outputOwner?.$kind === 'Shared',
      ) ?? [];

      if (createdShared.length === 0) {
        throw new Error('No shared MockMargin object in TX effects — check the TX');
      }

      const marginAddress = createdShared[0]!.objectId;
      console.log(`✓ MockMargin created: ${marginAddress}`);
      console.log(`  LTV: 75%  |  Borrow rate: 8% APY`);
      console.log(`  TX: ${EXPLORER}/${txResult.digest}`);
      envLines.push(`MOCK_MARGIN_ID=${marginAddress}`);
    }
  } else {
    console.log(`\n✓ MockMargin already set: ${env.MOCK_MARGIN_ID}`);
  }

  // ── Action required ──────────────────────────────────────────────────────────

  if (envLines.length > 0) {
    console.log('\n=== ACTION REQUIRED ===');
    console.log('Add these lines to your .env file:\n');
    for (const line of envLines) {
      console.log(`  ${line}`);
    }
    if (envLines.some(l => l.startsWith('DEEPBOOK_BALANCE_MANAGER'))) {
      console.log('\nAlso fund the keeper wallet with DBUSDC for hedge orders.');
      console.log('On testnet, use the DeepBook faucet or mint DBUSDC directly.');
    }
  }

  console.log('\nSetup complete.');
}

main().catch((err) => {
  log.error({ err }, 'setup failed');
  process.exit(1);
});
