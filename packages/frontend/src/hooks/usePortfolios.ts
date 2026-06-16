import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type PatchPortfolioBody } from '@/lib/api'

export function usePortfolios(walletAddress: string | undefined) {
  return useQuery({
    queryKey: ['portfolios', walletAddress],
    queryFn: () => api.portfolios.list(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function usePortfolioDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['portfolio', id],
    queryFn: () => api.portfolios.get(id!),
    enabled: !!id,
    staleTime: 10_000,
    refetchInterval: 20_000,
  })
}

export function usePatchPortfolio(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PatchPortfolioBody) => api.portfolios.patch(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolio', id] })
      void qc.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })
}
