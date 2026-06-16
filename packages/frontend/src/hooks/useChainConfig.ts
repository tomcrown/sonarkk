import { useQuery } from '@tanstack/react-query'
import { api, type ChainConfig } from '@/lib/api'

export function useChainConfig() {
  return useQuery<ChainConfig>({
    queryKey: ['chain-config'],
    queryFn: api.chainConfig,
    staleTime: Infinity, // constants don't change per session
    retry: 3,
  })
}
