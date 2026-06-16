import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useSviSurface() {
  return useQuery({
    queryKey: ['svi-surface'],
    queryFn: api.sviSurface.get,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}
