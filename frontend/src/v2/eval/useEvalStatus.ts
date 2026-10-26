import { useQuery } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { tokenManager } from '@/services/tokenManager'

export interface EvalStatus {
  stats: boolean
  feedback: boolean
  household: string | null
}

const OFF: EvalStatus = { stats: false, feedback: false, household: null }

/** Which eval features the box has on. Never rejects, so the login redirect never fires. */
export function useEvalStatus() {
  return useQuery({
    queryKey: ['eval-status'],
    queryFn: () => api<EvalStatus>('/eval/status').catch(() => OFF),
    staleTime: Infinity,
    retry: false,
    enabled: !!tokenManager.getAccessToken(), // fetched once a parent is logged in
    placeholderData: OFF,
  })
}
