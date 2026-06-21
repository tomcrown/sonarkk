import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Load the monorepo root .env (packages/api is two levels deep).
const pkgDir = fileURLToPath(new URL('..', import.meta.url));
config({ path: resolve(pkgDir, '../../.env') });

const schema = z.object({
  // Optional: keeper address derivation for /chain-config endpoint.
  KEEPER_PRIVATE_KEY:  z.preprocess(v => v || undefined, z.string().min(1).optional()),
  // Optional: AI copilot routes are disabled when absent rather than crashing the server.
  ANTHROPIC_API_KEY:   z.preprocess(v => v || undefined, z.string().min(1).optional()),
  ANTHROPIC_MODEL:     z.string().default('claude-sonnet-4-6'),
  API_PORT:            z.coerce.number().default(3001),
  API_CORS_ORIGIN:     z.string().default('*'),

  DATABASE_URL:        z.string().min(1),
  PREDICT_SERVER_URL:  z.string().default('https://predict-server.testnet.mystenlabs.com'),
  SUI_NETWORK:         z.string().default('testnet'),
  SUI_GRPC_URL:        z.string().default('https://fullnode.testnet.sui.io:443'),
  PREDICT_PACKAGE:     z.string().min(1),
  PREDICT_OBJECT:      z.string().min(1),
  DUSDC_TYPE:          z.string().min(1),
  SONARK_PACKAGE:      z.string().min(1),

  // Seal key server object IDs (comma-separated). Threshold = 1 (any one server suffices).
  SEAL_KEY_SERVER_IDS: z.string().default(
    '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75,' +
    '0x6068c0acb197dddbacd4746a9de7f025b2ed5a5b6c1b1ab44dade4426d141da2',
  ),
  // Walrus testnet endpoints.
  WALRUS_PUBLISHER_URL:  z.string().default('https://publisher.walrus-testnet.walrus.space'),
  WALRUS_AGGREGATOR_URL: z.string().default('https://aggregator.walrus-testnet.walrus.space'),

  // MockLending and MockMargin shared object IDs (for PP + Margin Loop keeper-setup).
  MOCK_LENDING_ID: z.preprocess(v => v || undefined, z.string().optional()),
  MOCK_MARGIN_ID:  z.preprocess(v => v || undefined, z.string().optional()),

  // Telegram bot integration. Optional — Telegram routes are disabled when absent.
  TELEGRAM_BOT_TOKEN: z.preprocess(v => v || undefined, z.string().optional()),
});

export const env = schema.parse(process.env);
