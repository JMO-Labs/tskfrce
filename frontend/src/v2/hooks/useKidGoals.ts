import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, AuthError } from '../api'
import { blocked, kidInit, useAsKid } from './usePreview'
import { toastFail } from '../notify'
import type { Goal, KidGoals } from '../goalTypes'

export function useKidGoals(onExpired: () => void) {
  const as = useAsKid()
  const q = useQuery({
    queryKey: ['kid', 'goals', as],
    queryFn: () => api<KidGoals>('/kid/goals', kidInit(as)),
  })
  const expired = q.error instanceof AuthError
  useEffect(() => {
    if (expired) onExpired()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired])
  return q
}

export type KidGoalAction = 'suggest' | 'start' | 'add' | 'withdraw' | 'auto' | 'delete' | 'party-seen'

export function useKidGoalAction(onExpired: () => void) {
  const qc = useQueryClient()
  const as = useAsKid()
  return useMutation({
    mutationFn: ({ id, action, body }: { id?: number; action: KidGoalAction; body?: Record<string, unknown> }) => {
      if (as) return blocked()
      const url = action === 'suggest' || action === 'start' ? `/kid/goals/${action}` : action === 'delete' ? `/kid/goals/${id}` : `/kid/goals/${id}/${action}`
      const method = action === 'delete' ? 'DELETE' : 'POST'
      return api<Goal | undefined>(url, { method, ...(body ? { body } : {}), kid: true })
    },
    onError: (e: Error) => {
      if (e instanceof AuthError) onExpired()
      else toastFail(e)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['kid', 'goals'] })
      qc.invalidateQueries({ queryKey: ['kid', 'rewards'] })
      qc.invalidateQueries({ queryKey: ['kid', 'today'] }) // balance in the header
    },
  })
}

/** Play a Get out of jail free card on one of my penalties. */
export function usePlayJail(onExpired: () => void) {
  const qc = useQueryClient()
  const as = useAsKid()
  return useMutation({
    mutationFn: (penaltyId: number) => {
      if (as) return blocked()
      return api('/kid/goals/jail/play', { method: 'POST', body: { penalty_id: penaltyId }, kid: true })
    },
    onError: (e: Error) => {
      if (e instanceof AuthError) onExpired()
      else toastFail(e)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['kid'] }),
  })
}
