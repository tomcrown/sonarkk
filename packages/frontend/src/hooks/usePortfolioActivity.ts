import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function usePortfolioActivity(walletAddress: string | undefined, limit = 10) {
  return useQuery({
    queryKey: ['portfolio-activity', walletAddress, limit],
    queryFn: () => api.portfolios.activity(walletAddress!, limit),
    enabled: !!walletAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}
