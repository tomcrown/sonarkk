import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  SUI_NETWORK: z.enum(['testnet', 'mainnet', 'devnet', 'localnet']).default('testnet'),
  SUI_GRPC_URL: z.string().url().default('https://fullnode.testnet.sui.io:443'),
  SUI_GRAPHQL_URL: z
    .string()
    .url()
    .default('https://sui-testnet.mystenlabs.com/graphql'),

  PREDICT_PACKAGE: z.string().default(
    '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
  ),
  PREDICT_REGISTRY: z.string().default(
    '0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64',
  ),
  PREDICT_OBJECT: z.string().default(
    '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  ),
  DUSDC_TYPE: z.string().default(
    '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  ),

  PREDICT_SERVER_URL: z
    .string()
    .url()
    .default('https://predict-server.testnet.mystenlabs.com'),

  DEEPBOOK_PACKAGE: z.string().default(
    '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c',
  ),
  DEEPBOOK_REGISTRY: z.string().default(
    '0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1',
  ),

  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),

  KEEPER_PRIVATE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
