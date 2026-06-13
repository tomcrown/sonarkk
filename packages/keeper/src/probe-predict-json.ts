import { SuiGrpcClient } from '@mysten/sui/grpc';
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' });
const PREDICT = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const result = await (client.core as any).getObject({ objectId: PREDICT, include: { json: true } });
const json = result?.object?.json ?? result?.json;
console.log('TOP-LEVEL KEYS:', Object.keys(json || {}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vault = (json as any)?.vault;
console.log('VAULT KEYS:', Object.keys(vault || {}));
console.log('VAULT FIELDS:', JSON.stringify(vault, null, 2));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pricing = (json as any)?.pricing_config;
console.log('PRICING_CONFIG:', JSON.stringify(pricing, null, 2));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const risk = (json as any)?.risk_config;
console.log('RISK_CONFIG:', JSON.stringify(risk, null, 2));
