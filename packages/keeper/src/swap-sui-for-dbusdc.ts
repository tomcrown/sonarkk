/**
 * swap-sui-for-dbusdc.ts — Swap SUI → DBUSDC via DeepBook v3 SUI_DBUSDC pool.
 *
 * Purpose: Fund the keeper wallet with DBUSDC so the Hedged-PLP hedge can
 * execute a real DeepBook market order (long DBTC via DBUSDC).
 *
 * DBUSDC has no public testnet faucet (TreasuryCap-gated). The only way to
 * acquire it is via DeepBook's SUI_DBUSDC pool (pool::swap_exact_base_for_quote).
 * This does NOT require a BalanceManager.
 *
 * Pool: SUI_DBUSDC
 *   address: 0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5
 *   base: SUI (scalar 1e9, min_size = 1 SUI)
 *   quote: DBUSDC (scalar 1e6)
 *
 * After running this script:
 *   1. Check printed DBUSDC amount
 *   2. Run: pnpm --filter @sonarkk/keeper run setup
 *      → prints DEEPBOOK_BALANCE_MANAGER address
 *   3. Add DEEPBOOK_BALANCE_MANAGER to .env
 *   4. Run keeper — hedge will now execute a real DeepBook market order
 *
 * Usage:
 *   pnpm --filter @sonarkk/keeper run swap-dbusdc
 *   SWAP_SUI_AMOUNT=2.0 pnpm --filter @sonarkk/keeper run swap-dbusdc
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient, testnetCoins, testnetPools } from '@mysten/deepbook-v3';
import { env, EXPLORER_URL } from './env.js';

// Minimum SUI to reserve for gas (testnet swap costs ~0.003 SUI).
const GAS_RESERVE_SUI = 0.1;
// Default swap amount if SWAP_SUI_AMOUNT env is not set.
const DEFAULT_SWAP_SUI = 1.0;
// SUI pool minimum is 1 SUI (min_size = 1_000_000_000 raw).
const MIN_SWAP_SUI = 1.0;

const POOL_KEY = 'SUI_DBUSDC';
const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const DBUSDC_SCALAR = testnetCoins['DBUSDC']!.scalar; // 1e6

function fmt(label: string, value: string | number) {
  console.log(`  ${label.padEnd(28)}: ${value}`);
}

async function main() {
  console.log('=== Sonark — Swap SUI → DBUSDC ===\n');

  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  }
  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  fmt('Keeper address', keeperAddress);

  const client = new SuiGrpcClient({
    network: env.SUI_NETWORK as 'testnet',
    baseUrl: env.SUI_GRPC_URL,
  });

  // ── Read SUI balance ───────────────────────────────────────────────────────
  const suiBalRes = await client.core.getBalance({ owner: keeperAddress, coinType: SUI_TYPE });
  const suiBalRaw = BigInt(suiBalRes.balance?.balance ?? 0n);
  const suiBalFloat = Number(suiBalRaw) / 1e9;
  fmt('SUI balance', `${suiBalFloat.toFixed(4)} SUI`);

  // ── Determine swap amount ──────────────────────────────────────────────────
  const requestedAmount = parseFloat(process.env['SWAP_SUI_AMOUNT'] ?? String(DEFAULT_SWAP_SUI));
  const maxSwappable = Math.max(0, suiBalFloat - GAS_RESERVE_SUI);
  // Round down to the nearest 0.1 SUI (lot_size = 0.1 SUI).
  const swapAmount = Math.floor(Math.min(requestedAmount, maxSwappable) * 10) / 10;

  if (swapAmount < MIN_SWAP_SUI) {
    const needed = MIN_SWAP_SUI + GAS_RESERVE_SUI;
    console.error(
      `\n[ERROR] Not enough SUI to swap.\n` +
      `  Available for swap : ${maxSwappable.toFixed(4)} SUI\n` +
      `  Minimum swap       : ${MIN_SWAP_SUI} SUI (pool min_size)\n` +
      `  Need at least      : ${needed} SUI total (swap + gas reserve)\n` +
      `  Get more SUI from  : https://faucet.testnet.sui.io\n`,
    );
    process.exit(1);
  }

  fmt('Swap amount', `${swapAmount.toFixed(4)} SUI`);
  fmt('Gas reserve', `${GAS_RESERVE_SUI} SUI`);
  fmt('Pool', POOL_KEY);

  // ── Build PTB ──────────────────────────────────────────────────────────────
  const dbClient = new DeepBookClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    network: 'testnet',
    address: keeperAddress,
    coins: testnetCoins,
    pools: testnetPools,
  });

  const tx = new Transaction();
  // Set gas budget before splitCoins so the resolver knows exactly how much
  // SUI is reserved for gas and doesn't over-reserve when we split from tx.gas.
  tx.setGasBudget(10_000_000); // 0.01 SUI — ample for a single swap on testnet

  // SUI is the gas coin — coinWithBalance() can't use it directly because
  // gas resolution conflicts with coin selection.  Split from tx.gas instead.
  const swapAmountRaw = BigInt(Math.floor(swapAmount * 1e9));
  const baseCoin = tx.splitCoins(tx.gas, [swapAmountRaw]);

  // swapExactBaseForQuote: sell SUI (base) → receive DBUSDC (quote).
  // Pass baseCoin explicitly to bypass coinWithBalance for SUI.
  // deepAmount=0: no DEEP provided; fees are taken from the swap output.
  // minOut=0: accept any amount (testnet proof, no slippage requirement).
  const [baseCoinResult, quoteCoinResult, deepCoinResult] =
    dbClient.deepBook.swapExactBaseForQuote({
      poolKey: POOL_KEY,
      amount: swapAmount,
      deepAmount: 0,
      minOut: 0,
      baseCoin,
    })(tx);

  // Transfer received DBUSDC to keeper wallet.
  tx.transferObjects([quoteCoinResult], keeperAddress);
  // Return leftover SUI (if any, e.g. from partial fill) back to sender.
  tx.transferObjects([baseCoinResult, deepCoinResult], keeperAddress);

  // ── Execute ────────────────────────────────────────────────────────────────
  console.log('\nSubmitting swap TX...');
  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true },
  });

  if (result.$kind === 'FailedTransaction') {
    const status = result.FailedTransaction?.status;
    console.error('\n[FAILED]', JSON.stringify(status, null, 2));
    process.exit(1);
  }

  const digest = result.Transaction!.digest;
  console.log('\nWaiting for finality...');
  await client.core.waitForTransaction({ digest });

  // ── Read new DBUSDC balance ────────────────────────────────────────────────
  const dbType = testnetCoins['DBUSDC']!.type;
  let dbBalRaw = 0n;
  try {
    const dbBalRes = await client.core.getBalance({ owner: keeperAddress, coinType: dbType });
    dbBalRaw = BigInt(dbBalRes.balance?.balance ?? 0n);
  } catch {
    // balance may not be indexed yet
  }
  const dbBalFloat = Number(dbBalRaw) / DBUSDC_SCALAR;

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  SWAP COMPLETE');
  console.log('═'.repeat(60));
  fmt('TX digest', digest);
  fmt('Explorer', `${EXPLORER_URL}/${digest}`);
  fmt('SUI swapped', `${swapAmount.toFixed(4)} SUI`);
  fmt('DBUSDC balance (new)', `${dbBalFloat.toFixed(6)} DBUSDC`);
  console.log('\n' + '─'.repeat(60));
  console.log('  NEXT STEPS:');
  if (!env.DEEPBOOK_BALANCE_MANAGER) {
    console.log('  1. pnpm --filter @sonarkk/keeper run setup');
    console.log('     → creates BalanceManager, prints its address');
    console.log('  2. Add to .env:');
    console.log('       DEEPBOOK_BALANCE_MANAGER=<printed address>');
    console.log('  3. pnpm --filter @sonarkk/keeper run hedged-once');
    console.log('     → executes real hedge TX (long DBTC with DBUSDC)');
  } else {
    console.log(`  BalanceManager already set: ${env.DEEPBOOK_BALANCE_MANAGER}`);
    console.log('  Run: pnpm --filter @sonarkk/keeper run hedged-once');
    console.log('       → executes real hedge TX (long DBTC with DBUSDC)');
  }
  console.log('─'.repeat(60));
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
