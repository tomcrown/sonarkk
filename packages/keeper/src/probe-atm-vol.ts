import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { atmVol } from '@sonarkk/core';
import { env } from './env.js';

const client = new SuiGrpcClient({ network: env.SUI_NETWORK as 'testnet', baseUrl: env.SUI_GRPC_URL });

const ORACLES = [
  { id: '0x5b439cb6139f9f6470368c43235ecf68e11b32a3a3b619060c3cbdad9499e7a5', expiry: 1781242200000 },
  { id: '0x11540b3d1cb02646825e9787618d2cab42e631b2c0e4c1e59fc3debe7389fe44', expiry: 1781241300000 },
  { id: '0xb3e91c42738352d3ef0403f9a08e8ddc0acb43d5c2a02e33bb6da97d802e2c3b', expiry: 1781247600000 },
];

const SVI_SCALE = 1_000_000_000;

for (const o of ORACLES) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client.core as any).getObject({ objectId: o.id, include: { json: true } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (result?.object?.json ?? result?.json) as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = json?.svi as Record<string, any>;
  // gRPC getObject returns signed fields WITHOUT a .fields wrapper — e.g. s.rho.is_negative
  // (contrast: JSON-RPC showContent returns s.rho.fields.is_negative)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedField = (f: any): number =>
    (f?.is_negative ? -1 : 1) * (Number(f?.magnitude) / SVI_SCALE);

  const sviParams = {
    a:     Number(s?.a) / SVI_SCALE,
    b:     Number(s?.b) / SVI_SCALE,
    rho:   signedField(s?.rho),
    m:     signedField(s?.m),
    sigma: Number(s?.sigma) / SVI_SCALE,
  };
  const t_years = Math.max(0, (o.expiry - Date.now()) / (365.25 * 24 * 60 * 60 * 1000));
  const vol = atmVol(sviParams, t_years);
  const exp_min = Math.round((o.expiry - Date.now()) / 60000);
  console.log(
    `oracle ${o.id.slice(0,12)}...` +
    `  expiry_in=${exp_min}min` +
    `  t_years=${t_years.toFixed(6)}` +
    `  ATM_vol=${(vol*100).toFixed(2)}%` +
    `  passes_15%=${vol>=0.15}`,
  );
}
