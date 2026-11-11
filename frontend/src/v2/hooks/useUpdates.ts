import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'

export interface Updates {
  version: string
  channel: string
  last_result: string | null
  last_version: string | null
  major_available: string | null
}

export const useUpdates = () =>
  useQuery({ queryKey: ['updates'], queryFn: () => api<Updates>('/updates') })

export function usePatchUpdates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { channel?: string; pull_major?: string }) =>
      api<Updates>('/updates', { method: 'PATCH', body: patch }),
    onSuccess: (data) => {
      qc.setQueryData(['updates'], data)
    },
  })
}
