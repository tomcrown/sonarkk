import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

export const SUI_NETWORK = (import.meta.env.VITE_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'

export const SUI_FULLNODE_URL = getJsonRpcFullnodeUrl(SUI_NETWORK)

/** Explorer URL for a transaction digest */
export function txUrl(digest: string): string {
  return `https://suiexplorer.com/txblock/${digest}?network=${SUI_NETWORK}`
}

/** Explorer URL for an object */
export function objectUrl(objectId: string): string {
  return `https://suiexplorer.com/object/${objectId}?network=${SUI_NETWORK}`
}

/** Explorer URL for an address */
export function addressUrl(address: string): string {
  return `https://suiexplorer.com/address/${address}?network=${SUI_NETWORK}`
}
