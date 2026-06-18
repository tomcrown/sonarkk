import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function usePortfolioChart(walletAddress: string | undefined) {
  return useQuery({
    queryKey: ['portfolio-chart', walletAddress],
    queryFn: () => api.portfolios.chart(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
