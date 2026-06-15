/**
 * recover-dusdc.ts — Withdraw DUSDC from all old portfolios before redeploy.
 *
 * Share → portfolio pairs extracted via BCS inspection of the keeper wallet.
 * Total recoverable: ~95 DUSDC.
 *
 * Usage: pnpm --filter @sonarkk/keeper exec tsx src/recover-dusdc.ts
 */

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { env } from './env.js';
import { log } from './logger.js';

const OLD_PACKAGE = '0xc700c7f3531f0adc341a874be76f0988e9cb3dac35496be17fd552ab0c3912cc';
const EXPLORER    = 'https://testnet.suivision.xyz/txblock';

const PAIRS: { shareId: string; portfolioId: string; shares: number }[] = [
  { shareId: '0x123edf459a7450843db9372cc21785f490002671813abfb3fa82b3dfbd625a2e', portfolioId: '0x2f43e4c9f222aa16ffc3442484ba0b39553ae916e634337db9f19b3fbe27ee61', shares: 5_000_000 },
  { shareId: '0x13b92e34024aeb38bed9513ec596c1e602134e1552be69e77a878d30c257bb9e', portfolioId: '0x667ec925b17fcbefe2c12d025e741a38d3d22ea861666d0155d7f077d0f299c1', shares: 15_000_000 },
  { shareId: '0x200481f0526ef40f48e4ec782c264e604a64dfbcc616b479186e64d8b58487cc', portfolioId: '0x510bb9cccd54309b886e2a3b90918c5c9eab1fd69d509ce39e798f327f184071', shares: 5_000_000 },
  { shareId: '0x5d0f2b4631d5f4842a999ce7a1cad63432562943438328cd38e612d239b5fff3', portfolioId: '0x15295aa833b969a56e60165b06f7026255bf4f0a6298ee1caba690751b59df2d', shares: 5_000_000 },
  { shareId: '0x88e31530791a0ecbdbe77c05e54cb76c1c6eae6bcb64741f6ed72b6362cee164', portfolioId: '0x3e6502584de3dfc8402592bee35bbca25b73909a3d2a199733e56dd8b7ba4536', shares: 15_000_000 },
  { shareId: '0x8b188ec7b4b7d5c7cd118eaccf8dbf180a339d2dd6f0707bf08f9602e2ef580c', portfolioId: '0x074bccc59206e44d984684949f114947453914dfc1b4d155f1a71590d3128720', shares: 15_000_000 },
  { shareId: '0x9e3f09080acc551f198f1748930de5ddf5cd4f6b161ba5d6a4446616dbaf8eb3', portfolioId: '0x033abbcc085042e4aad3f58f97be555de32ee5a0e51fc78fb9e015ab8bb62cfa', shares: 20_000_000 },
  { shareId: '0xb4b9e14d27101085cc4f242986c24f1a6372dcd88146010c0691643b7f328915', portfolioId: '0x4848b7b192d80848ce6832db3bf7a7c5784cf6b929a55f4e92d6fdcc14ec0c46', shares: 15_000_000 },
];

async function main() {
  console.log('=== DUSDC Recovery — withdraw from old portfolios ===');
  console.log(`  Pairs: ${PAIRS.length}  |  Expected: ~${PAIRS.reduce((s, p) => s + p.shares, 0) / 1e6} DUSDC\n`);

  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  }
  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  console.log(`Keeper: ${keeperAddress}`);

  const client = new SuiGrpcClient({
    network: env.SUI_NETWORK as 'testnet',
    baseUrl: env.SUI_GRPC_URL,
  });

  let totalRecovered = 0n;

  for (const pair of PAIRS) {
    const { shareId, portfolioId, shares } = pair;
    console.log(`\n  Share ${shareId.slice(0, 14)}... (${shares / 1e6} DUSDC) → Portfolio ${portfolioId.slice(0, 14)}...`);

    try {
      const tx = new Transaction();
      const coin = tx.moveCall({
        target: `${OLD_PACKAGE}::portfolio::withdraw`,
        typeArguments: [env.DUSDC_TYPE],
        arguments: [tx.object(portfolioId), tx.object(shareId)],
      });
      tx.transferObjects([coin], keeperAddress);

      const result = await client.core.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        include: { effects: true, balanceChanges: true },
      });

      if (result.$kind === 'FailedTransaction') {
        console.log(`  ✗ FAILED: ${JSON.stringify(result.FailedTransaction?.status)}`);
        continue;
      }

      const txResult = result.Transaction!;
      await client.core.waitForTransaction({ digest: txResult.digest });

      const dusdcChange = (txResult.balanceChanges ?? []).find(
        bc => bc.coinType === env.DUSDC_TYPE && BigInt(bc.amount) > 0n,
      );
      const recovered = dusdcChange ? BigInt(dusdcChange.amount) : 0n;
      totalRecovered += recovered;
      console.log(`  ✓ ${Number(recovered) / 1e6} DUSDC | TX: ${EXPLORER}/${txResult.digest}`);
    } catch (err) {
      log.error({ shareId, err }, 'withdraw failed');
      console.log(`  ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n══ Recovery complete: ${Number(totalRecovered) / 1e6} DUSDC recovered ══`);
  console.log('\nNext: run deploy-all-strategies to deploy fresh portfolios.');
}

main().catch(err => {
  log.error({ err }, 'recover-dusdc failed');
  process.exit(1);
});
