import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useLeaderboard(limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['leaderboard', limit, offset],
    queryFn: () => api.leaderboard.list({ limit, offset }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
