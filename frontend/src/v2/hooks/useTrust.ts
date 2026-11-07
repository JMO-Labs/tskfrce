import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { toastFail, toastOk } from '@/v2/notify'
import type { SelfApproved } from '@/v2/trustTypes'

export const useSelfApproved = (kidId: number) =>
  useQuery({ queryKey: ['self-approved', kidId], queryFn: () => api<SelfApproved[]>(`/kids/${kidId}/self-approved`) })

/** Wasn't done: points back, chore returns (or is dropped if from an older day). */
export function useTakeBack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, lower_trust }: { id: number; lower_trust: boolean }) =>
      api(`/chores/${id}/take-back`, { method: 'POST', body: { lower_trust } }),
    onSuccess: () => {
      toastOk('Taken back')
      return Promise.all(['self-approved', 'today', 'kids', 'kid-points', 'chores-today'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    onError: toastFail,
  })
}
