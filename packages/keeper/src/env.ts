import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const _dir = dirname(fileURLToPath(import.meta.url));
// 3 levels up: src/ → keeper/ → packages/ → sonarkk/.env
config({ path: resolve(_dir, '../../../.env') });

const keeperEnvSchema = z.object({
  SUI_NETWORK: z.enum(['testnet', 'mainnet', 'devnet', 'localnet']).default('testnet'),
  SUI_GRPC_URL: z.string().url().default('https://fullnode.testnet.sui.io:443'),
  SUI_GRAPHQL_URL: z.string().url().default('https://sui-testnet.mystenlabs.com/graphql'),

  PREDICT_PACKAGE: z.string().default(
    '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
  ),
  PREDICT_OBJECT: z.string().default(
    '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  ),
  DUSDC_TYPE: z.string().default(
    '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  ),
  PREDICT_SERVER_URL: z.string().url().default('https://predict-server.testnet.mystenlabs.com'),

  SONARK_PACKAGE: z.string().min(1, 'SONARK_PACKAGE must be set (run integration-phase2 to publish)'),

  DEEPBOOK_PACKAGE: z.string().default(
    '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c',
  ),
  DEEPBOOK_REGISTRY: z.string().default(
    '0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1',
  ),
  DEEPBOOK_DEEP_TREASURY: z.string().default(
    '0x69fffdae0075f8f71f4fa793549c11079266910e8905169845af1f5d00e09dcb',
  ),
  DEEPBOOK_DBTC_DBUSDC_POOL: z.string().default(
    '0x0dce0aa771074eb83d1f4a29d48be8248d4d2190976a5241f66b43ec18fa34de',
  ),
  // Pre-created DeepBook BalanceManager for hedge orders.
  // Run: pnpm --filter @sonarkk/keeper run setup
  DEEPBOOK_BALANCE_MANAGER: z.string().optional(),

  // Keeper key (dedicated, not main wallet).
  KEEPER_PRIVATE_KEY: z.string().min(1, 'KEEPER_PRIVATE_KEY must be set'),

  // Kill switch: set KEEPER_PAUSED=true to halt the loop cleanly.
  KEEPER_PAUSED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // Polling interval in ms (default: 30s).
  KEEPER_POLL_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('30000'),

  DATABASE_URL: z.string().optional(),

  // Telegram bot token — optional. When set, keeper sends notifications to linked wallets.
  TELEGRAM_BOT_TOKEN: z.preprocess(v => v || undefined, z.string().optional()),

  // MockLending shared object ID (deployed by setup.ts, used by strategy ④).
  // Required for PRINCIPAL_PROTECTED portfolios.
  MOCK_LENDING_ID: z.string().optional(),

  // MockMargin shared object ID (deployed by setup.ts, used by strategy ⑧ MARGIN_LOOP).
  // Required for MARGIN_LOOP portfolios.
  MOCK_MARGIN_ID: z.string().optional(),

  // PREDICT_PACKAGE is already above — PREDICT_REGISTRY used for create_manager.
  PREDICT_REGISTRY: z.string().default(
    '0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64',
  ),

  // Seal key server object IDs (comma-separated). From https://seal-docs.wal.app/
  // Defaults are the two Mysten Labs independent key servers on Sui testnet.
  SEAL_KEY_SERVER_IDS: z.string().default(
    '0x2c898d7d5e4d9be2a0ad91f5c8dba8440cbbdc5296a90fc15f57c1f3ac5d48e3,' +
    '0x34d5b90e5b7571538e38b2e07c02a5ae9d82e1c1c05e5e5f10e69e9e4e93f43',
  ),

  // Walrus aggregator URL for reading blobs (to fetch encrypted vault configs).
  WALRUS_AGGREGATOR_URL: z.string().url().default('https://aggregator.walrus-testnet.walrus.space'),
});

export type KeeperEnv = z.infer<typeof keeperEnvSchema>;

const parsed = keeperEnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[keeper] Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** PLP token type — derived from the Predict package address using the standard OTW pattern. */
export const PLP_TYPE = `${env.PREDICT_PACKAGE}::plp::PLP` as const;

/** Sui system clock object ID. */
export const CLOCK_ID = '0x0000000000000000000000000000000000000000000000000000000000000006' as const;

/** SuiVision testnet explorer URL base. */
export const EXPLORER_URL = 'https://testnet.suivision.xyz/txblock' as const;
