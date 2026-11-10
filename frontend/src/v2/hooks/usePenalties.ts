import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { toastFail, toastOk } from '@/v2/notify'
import type { Penalty, PenaltyDraft, PenaltyOptions } from '@/v2/penaltyTypes'

const INVALIDATE = ['today', 'kids', 'kid-points', 'penalties', 'devices']
const refresh = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all(INVALIDATE.map((k) => qc.invalidateQueries({ queryKey: [k] })))

export const usePenaltyOptions = (enabled: boolean) =>
  useQuery({ queryKey: ['penalties', 'options'], queryFn: () => api<PenaltyOptions>('/penalties/options'), enabled })

export const useKidPenalties = (kidId: number) =>
  useQuery({ queryKey: ['penalties', kidId], queryFn: () => api<Penalty[]>(`/kids/${kidId}/penalties`) })

export type GiveBody = PenaltyDraft & { kid_ids: number[]; chore_run_id?: number; notification_id?: number }

export function useGivePenalty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: GiveBody) => api<Penalty[]>('/penalties', { method: 'POST', body }),
    onSuccess: () => {
      toastOk('Penalty given')
      return refresh(qc)
    },
    onError: toastFail,
  })
}

export function usePenaltyAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action, minutes }: { id: number; action: 'shorten' | 'forgive' | 'cancel'; minutes?: number }) =>
      api<Penalty>(`/penalties/${id}/${action}`, { method: 'POST', body: action === 'shorten' ? { minutes } : undefined }),
    onSuccess: () => refresh(qc),
    onError: toastFail,
  })
}

export function useSeenPenalty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api(`/kid/penalties/${id}/seen`, { method: 'POST', kid: true }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['kid'] }),
  })
}
