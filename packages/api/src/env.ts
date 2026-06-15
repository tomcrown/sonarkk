import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Load the monorepo root .env (packages/api is two levels deep).
const pkgDir = fileURLToPath(new URL('..', import.meta.url));
config({ path: resolve(pkgDir, '../../.env') });

const schema = z.object({
  // Optional: AI copilot routes are disabled when absent rather than crashing the server.
  GEMINI_API_KEY:      z.string().min(1).optional(),
  GEMINI_MODEL:        z.string().default('gemini-2.0-flash'),
  API_PORT:            z.coerce.number().default(3001),
  API_CORS_ORIGIN:     z.string().default('*'),

  DATABASE_URL:        z.string().min(1),
  PREDICT_SERVER_URL:  z.string().default('https://predict-server.testnet.mystenlabs.com'),
  SUI_NETWORK:         z.string().default('testnet'),
  SUI_GRPC_URL:        z.string().default('https://fullnode.testnet.sui.io:443'),
  PREDICT_PACKAGE:     z.string().min(1),
  PREDICT_OBJECT:      z.string().min(1),
  DUSDC_TYPE:          z.string().min(1),
});

export const env = schema.parse(process.env);
