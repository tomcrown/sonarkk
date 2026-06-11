import { suiClient } from './sui-client.js';
import { env } from './env.js';
import { Transaction } from '@mysten/sui/transactions';

const PREDICT_OBJECT = env.PREDICT_OBJECT;
const PREDICT_PACKAGE = env.PREDICT_PACKAGE;
const DUSDC_TYPE = env.DUSDC_TYPE;
const ACTIVE_ADDRESS = '0xa02306f408248d325f1cd839fb6f0c76a6c7abd0f43922f0a2258a550f9610a5';

async function devInspect(target: string, typeArgs: string[], objectArgs: string[]): Promise<bigint | null> {
  const tx = new Transaction();
  tx.setSender(ACTIVE_ADDRESS);
  tx.moveCall({ target, typeArguments: typeArgs, arguments: objectArgs.map((a) => tx.object(a)) });
  const sim = await suiClient.core.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  if (sim.$kind === 'FailedTransaction') return null;
  const bcs = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bcs) return null;
  return Buffer.from(bcs).readBigUInt64LE(0);
}

async function main() {
  // Get object with content
  const raw = await suiClient.core.getObject({ 
    objectId: PREDICT_OBJECT, 
    include: { content: true } as never 
  }) as unknown as { object: Record<string, unknown> };
  
  console.log('Object fields:', Object.keys(raw.object ?? {}));
  const content = raw.object?.['content'] as Record<string, unknown> | undefined;
  if (content) {
    console.log('\ncontent keys:', Object.keys(content));
    const fields = content['fields'] as Record<string, unknown> | undefined;
    if (fields) {
      console.log('fields keys:', Object.keys(fields));
      console.log('\nFields JSON (first 3000):');
      console.log(JSON.stringify(fields, null, 2).slice(0, 3000));
    }
  }

  // Try view functions with correct module paths  
  // From Phase 0: vault_value, balance, total_max_payout are confirmed views
  // Try different module names they might live in
  const targets = [
    `${PREDICT_PACKAGE}::predict::vault_value`,
    `${PREDICT_PACKAGE}::vault::vault_value`,
    `${PREDICT_PACKAGE}::predict::balance`,
    `${PREDICT_PACKAGE}::predict::total_max_payout`,
    `${PREDICT_PACKAGE}::predict::available_withdrawal`,
    `${PREDICT_PACKAGE}::predict::get_trade_amounts`,
  ];
  
  console.log('\n--- View function results ---');
  for (const t of targets) {
    const v = await devInspect(t, [DUSDC_TYPE], [PREDICT_OBJECT]);
    console.log(`${t.split('::').slice(-2).join('::')} = ${v !== null ? v : 'FAILED'}`);
  }
}

main().catch(console.error);
