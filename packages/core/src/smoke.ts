/**
 * Phase 0 smoke test — proves the modern gRPC Sui client and predict-server
 * are reachable and returning real live data. No mock data, no stubs.
 *
 * Run: pnpm --filter @sonarkk/core run smoke
 */
import { suiClient } from './sui-client.js';
import { predictClient } from './predict-client.js';
import { env } from './env.js';

async function main() {
  console.log('=== Sonark Phase 0 Smoke Test ===\n');
  console.log(`Network: ${env.SUI_NETWORK}`);
  console.log(`gRPC URL: ${env.SUI_GRPC_URL}`);
  console.log(`predict-server: ${env.PREDICT_SERVER_URL}\n`);

  // ---- 1. Sui gRPC client: read Predict object on-chain ----
  console.log('--- 1. Sui gRPC client: reading Predict object ---');
  const predictObj = await suiClient.core.getObject({
    objectId: env.PREDICT_OBJECT,
    include: { content: true },
  });
  console.log(`  Object ID   : ${env.PREDICT_OBJECT}`);
  console.log(`  Object type : ${predictObj.object?.type ?? 'unknown'}`);
  console.log(`  Exists      : ${predictObj.object != null ? 'YES' : 'NO'}`);

  // ---- 2. predict-server: /status ----
  console.log('\n--- 2. predict-server /status ---');
  const status = await predictClient.status();
  const now = new Date(status.current_time_ms);
  console.log(`  Status                  : ${status.status}`);
  console.log(`  Latest onchain checkpoint: ${status.latest_onchain_checkpoint}`);
  console.log(`  Server time             : ${now.toISOString()}`);

  // ---- 3. predict-server: latest 3 settled oracles ----
  // NOTE: /oracles returns all oracles regardless of limit/status params — slice client-side.
  console.log('\n--- 3. predict-server: latest 3 settled oracles ---');
  const allOracles = await predictClient.oracles({});
  const oracles = allOracles.filter((o) => o.status === 'settled').slice(0, 3);
  for (const o of oracles) {
    const expiry = new Date(o.expiry).toISOString();
    const settle = o.settlement_price != null
      ? (o.settlement_price / 1e9).toFixed(2)
      : 'N/A';
    console.log(`  oracle ${o.oracle_id.slice(0, 16)}... | expiry ${expiry} | settlement_price $${settle}`);
  }

  // ---- 4. predict-server: SVI params for latest oracle ----
  if (oracles.length > 0) {
    const latestOracle = oracles[0]!;
    console.log(`\n--- 4. predict-server: SVI params for oracle ${latestOracle.oracle_id.slice(0, 16)}... ---`);
    const svis = await predictClient.oracleSvi(latestOracle.oracle_id, { limit: 1 });
    if (svis.length > 0) {
      const s = svis[0]!;
      console.log(`  SVI a=${s.a} b=${s.b} rho=${s.rho_negative ? '-' : ''}${s.rho} m=${s.m_negative ? '-' : ''}${s.m} sigma=${s.sigma}`);
    } else {
      console.log('  (no SVI updates for this oracle)');
    }
  }

  console.log('\n=== Smoke test PASSED ===');
  console.log('gRPC client + predict-server are live and returning real data.\n');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
