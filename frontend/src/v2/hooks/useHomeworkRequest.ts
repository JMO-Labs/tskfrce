import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

/** Kid asks a parent for homework time. */
export function useAskHomework() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api('/kid/homework', { method: 'POST', kid: true }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['kid', 'today'] }),
  })
}

/** Parent answers a homework request: approve (with minutes) or deny. */
export function useDecideHomework() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approve, minutes }: { id: number; approve: boolean; minutes?: number }) =>
      api(`/homework/requests/${id}/${approve ? 'approve' : 'deny'}`, { method: 'POST', ...(approve ? { body: { minutes: minutes ?? 60 } } : {}) }),
    onSettled: () => Promise.all(['today', 'devices', 'inbox', 'homework-activity'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}
