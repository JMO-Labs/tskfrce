import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'
import type { HappyHour } from '@/v2/types'

export interface HappyHourStart {
  /** omitted = every kid */
  kid_ids?: number[]
  minutes?: 30 | 60 | 90
  mult_x10?: 15 | 20 | 30
}

/** Running now plus the last 10; polled so a stop or an auto boost shows up. */
export const useHappyHours = () =>
  useQuery({ queryKey: ['happy-hour'], queryFn: () => api<{ active: HappyHour[]; recent: HappyHour[] }>('/happy-hour'), refetchInterval: 30_000 })

function useHhMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(['happy-hour', 'today'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}

export const useStartHappyHour = () => useHhMutation((body: HappyHourStart) => api<HappyHour>('/happy-hour', { method: 'POST', body }))
export const useStopHappyHour = () => useHhMutation((id: number) => api<HappyHour>(`/happy-hour/${id}/stop`, { method: 'POST' }))
