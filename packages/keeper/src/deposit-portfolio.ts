/**
 * deposit-portfolio.ts — Deposit DUSDC into the HEDGED_PLP portfolio.
 *
 * Increases available_balance so the hedge budget can clear the pool
 * minimum order size (0.00001 DBTC ≈ $0.60).
 *
 * Usage:
 *   DEPOSIT_DUSDC=5 pnpm --filter @sonarkk/keeper exec tsx src/deposit-portfolio.ts
 */
import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import { env, CLOCK_ID, EXPLORER_URL } from './env.js';

const PORTFOLIO_ID = process.env['PORTFOLIO_ID']
  ?? '0x7ac276f96cc4efe75c4a3af0d5556e9badb078f85b2796942cece73b0536b552';
const DEPOSIT_DUSDC = parseFloat(process.env['DEPOSIT_DUSDC'] ?? '5');
const DEPOSIT_RAW   = BigInt(Math.floor(DEPOSIT_DUSDC * 1_000_000));

async function main() {
  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  }
  const addr = keypair.getPublicKey().toSuiAddress();

  const client = new SuiGrpcClient({ network: env.SUI_NETWORK as 'testnet', baseUrl: env.SUI_GRPC_URL });

  console.log(`Depositing ${DEPOSIT_DUSDC} DUSDC into portfolio ${PORTFOLIO_ID.slice(0,10)}...`);
  console.log('Keeper:', addr);

  const tx = new Transaction();
  const duscCoin = coinWithBalance({ type: env.DUSDC_TYPE, balance: DEPOSIT_RAW });
  const share = tx.moveCall({
    target: `${env.SONARK_PACKAGE}::portfolio::deposit`,
    typeArguments: [env.DUSDC_TYPE],
    arguments: [tx.object(PORTFOLIO_ID), duscCoin, tx.object(CLOCK_ID)],
  });
  tx.transferObjects([share], addr);

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    include: { effects: true },
  });

  if (result.$kind === 'FailedTransaction') {
    console.error('FAILED', JSON.stringify(result.FailedTransaction?.status));
    process.exit(1);
  }

  const digest = result.Transaction!.digest;
  await client.core.waitForTransaction({ digest });

  console.log('\n✓ Deposit complete');
  console.log('  TX:      ', digest);
  console.log('  Explorer:', `${EXPLORER_URL}/${digest}`);
  console.log(`  Deposited: ${DEPOSIT_DUSDC} DUSDC`);
  console.log('  PortfolioShare transferred to keeper wallet');
}

main().catch((err) => { console.error('[FATAL]', err); process.exit(1); });
