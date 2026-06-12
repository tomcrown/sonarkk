import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { env } from './env.js';
async function main() {
  let keypair: Ed25519Keypair;
  try { keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY); }
  catch { const b = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64'); keypair = Ed25519Keypair.fromSecretKey(b.slice(1)); }
  const addr = keypair.getPublicKey().toSuiAddress();
  const client = new SuiGrpcClient({ network: env.SUI_NETWORK as 'testnet', baseUrl: env.SUI_GRPC_URL });
  const DBUSDC_TYPE = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';
  const d  = await (client.core as any).getBalance({ owner: addr, coinType: env.DUSDC_TYPE });
  const db = await (client.core as any).getBalance({ owner: addr, coinType: DBUSDC_TYPE });
  const s  = await (client.core as any).getBalance({ owner: addr, coinType: '0x2::sui::SUI' });
  console.log('Keeper address:', addr);
  console.log('DUSDC: ', Number(d?.balance?.balance ?? 0) / 1e6, 'DUSDC');
  console.log('DBUSDC:', Number(db?.balance?.balance ?? 0) / 1e6, 'DBUSDC');
  console.log('SUI:   ', Number(s?.balance?.balance ?? 0) / 1e9, 'SUI');
}
main().catch(console.error);
