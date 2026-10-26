import { useQuery } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { tokenManager } from '@/services/tokenManager'

export interface EvalStatus {
  stats: boolean
  feedback: boolean
  household: string | null
}

const OFF: EvalStatus = { stats: false, feedback: false, household: null }
// Same values as OFF, but a distinct object so a failed fetch is refetchable.
const FAILED: EvalStatus = { ...OFF }

/** Which eval features the box has on. Never rejects, so the login redirect never fires. */
export function useEvalStatus() {
  const q = useQuery({
    queryKey: ['eval-status'],
    queryFn: () => api<EvalStatus>('/eval/status').catch(() => FAILED),
    staleTime: (query) => (query.state.data === FAILED ? 30_000 : Infinity),
    retry: false,
    enabled: !!tokenManager.getAccessToken(), // fetched once a parent is logged in
  })
  // data is OFF when disabled or failed; `loading` is true only while the first fetch is in flight
  return { data: q.data ?? OFF, loading: q.isLoading }
}
