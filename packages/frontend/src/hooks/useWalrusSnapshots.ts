import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWalrusSnapshots, triggerWalrusSnapshot } from '@/lib/api'

export function useWalrusSnapshots() {
  return useQuery({
    queryKey: ['walrus-snapshots'],
    queryFn: fetchWalrusSnapshots,
    staleTime: 60_000,
  })
}

export function useTriggerWalrusSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: triggerWalrusSnapshot,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['walrus-snapshots'] })
      void queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
    },
  })
}
