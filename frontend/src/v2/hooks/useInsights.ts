import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { Insights } from '../today/insightsTypes'

/** GET /today/insights, refreshed every minute: trends move slowly. */
export const useInsights = (enabled = true) =>
  useQuery({ enabled, queryKey: ['today-insights'], queryFn: () => api<Insights>('/today/insights'), refetchInterval: 60_000, refetchOnWindowFocus: true })
