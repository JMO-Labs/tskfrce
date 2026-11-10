import { useQuery } from '@tanstack/react-query'
import { api } from '@/v2/api'
import type { CreateGoalBody, Goal, GoalSettings, ParentGoals } from '@/v2/goalTypes'
import { useInvalidating } from './useRewards'

export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => api<ParentGoals>('/goals') })

export const useGoalSettings = () =>
  useQuery({ queryKey: ['goal-settings'], queryFn: () => api<GoalSettings>('/goals/settings') })

export const usePatchGoalSettings = () =>
  useInvalidating(
    (body: Partial<GoalSettings>) => api<GoalSettings>('/goals/settings', { method: 'PATCH', body }),
    ['goal-settings', 'goals'],
  )

export const useCreateGoal = () =>
  useInvalidating(
    (body: CreateGoalBody) => api<Goal[]>('/goals', { method: 'POST', body }),
    ['goals', 'today'],
  )

export type GoalAction = 'price' | 'decline' | 'fulfill' | 'chip-in' | 'delete' | 'patch'

export const useGoalAction = () =>
  useInvalidating(({ id, action, body }: { id: number; action: GoalAction; body?: Record<string, unknown> }) => {
    const url = action === 'delete' || action === 'patch' ? `/goals/${id}` : `/goals/${id}/${action}`
    const method = action === 'delete' ? 'DELETE' : action === 'patch' ? 'PATCH' : 'POST'
    return api<Goal | undefined>(url, body ? { method, body } : { method })
  }, ['goals', 'today'])
