import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { env } from './env.js';
import { atmVol } from '@sonarkk/core';

const SVI_SCALE = 1_000_000_000;
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
const client = new SuiGrpcClient({ network: env.SUI_NETWORK as 'testnet', baseUrl: env.SUI_GRPC_URL });

async function main() {
  // Fetch active oracles from predict-server
  const res = await fetch(`${env.PREDICT_SERVER_URL}/oracles?status=active&limit=20`);
  const all = await res.json() as Array<{ oracle_id: string; expiry: number; status: string }>;
  const now = Date.now();
  // Short-dated: expiry within 6 hours (the typical 2h oracles)
  const oracles = all.filter(o => o.expiry > now && (o.expiry - now) < 6 * 3600 * 1000);
  console.log(`Active oracles total: ${all.length}, short-dated (<6h remaining): ${oracles.length}`);
  console.log();

  let passPlp = 0, passHedged = 0, total = 0;
  for (const o of oracles.slice(0, 10)) {
    const t = Math.max(0, (o.expiry - now)) / MS_PER_YEAR;
    const expMin = Math.round((o.expiry - now) / 60000);
    try {
      const result = await (client.core as any).getObject({ objectId: o.oracle_id, include: { json: true } });
      const json = (result?.object?.json ?? result?.json) as Record<string, any>;
      const s = json?.svi as Record<string, any>;
      if (!s) { console.log(`  ${o.oracle_id.slice(0,12)}... no SVI field`); continue; }
      const sig = (f: any) => (f?.is_negative ? -1 : 1) * (Number(f?.magnitude) / SVI_SCALE);
      const svi = {
        a: Number(s.a) / SVI_SCALE,
        b: Number(s.b) / SVI_SCALE,
        rho: sig(s.rho),
        m: sig(s.m),
        sigma: Number(s.sigma) / SVI_SCALE,
      };
      const vol = atmVol(svi, t);
      const p15 = vol >= 0.15, p18 = vol >= 0.18;
      if (p15) passPlp++;
      if (p18) passHedged++;
      total++;
      console.log(`  ${o.oracle_id.slice(0,12)}...  ${expMin}min  ATM=${(vol*100).toFixed(2)}%  pass_plp=${p15}  pass_hedged=${p18}`);
    } catch (err) {
      console.log(`  ${o.oracle_id.slice(0,12)}...  ${expMin}min  ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log();
  console.log(`Summary: ${total} oracles read`);
  console.log(`  pass plp_supplier (>=15%):  ${passPlp}/${total}`);
  console.log(`  pass hedged_plp   (>=18%):  ${passHedged}/${total}`);
}
main().catch(console.error);
