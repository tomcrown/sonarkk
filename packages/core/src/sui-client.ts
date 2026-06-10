import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import type { SuiClientTypes } from '@mysten/sui/client';
import { env } from './env.js';

const network = env.SUI_NETWORK as SuiClientTypes.Network;

/**
 * Primary client — gRPC for most operations (replaces deprecated JSON-RPC SuiClient).
 * Import and use this throughout the codebase.
 */
export const suiClient = new SuiGrpcClient({
  network,
  baseUrl: env.SUI_GRPC_URL,
});

/**
 * GraphQL client — use for complex queries: event filtering, pagination,
 * and historical lookups that gRPC does not support natively.
 */
export const graphqlClient = new SuiGraphQLClient({
  url: env.SUI_GRAPHQL_URL,
  network,
});
