import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useMarketContext(portfolioId?: string) {
  return useQuery({
    queryKey: ['context', portfolioId],
    queryFn: () => api.context.get(portfolioId),
    staleTime: 20_000,
    refetchInterval: 30_000,
  })
}
