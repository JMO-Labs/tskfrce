import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { useAsKid } from '@/v2/hooks/usePreview'
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

export interface GoalPenaltyBody {
  goal_id: number
  mode: 'take' | 'raise'
  amount: number
  reason?: string
}

/** Family penalty on a family goal: take points from it or raise its target. */
export function useGoalPenalty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: GoalPenaltyBody) => api('/penalties/goal', { method: 'POST', body }),
    onSuccess: () => {
      toastOk('Penalty given')
      return Promise.all([refresh(qc), qc.invalidateQueries({ queryKey: ['goals'] })])
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

/** Kid saw a no-earn-back penalty card; a parent previewing as the kid doesn't count. */
export function useSeenPenalty() {
  const qc = useQueryClient()
  const as = useAsKid()
  return useMutation({
    mutationFn: async (id: number) => {
      if (!as) await api(`/kid/penalties/${id}/seen`, { method: 'POST', kid: true })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['kid'] }),
  })
}
