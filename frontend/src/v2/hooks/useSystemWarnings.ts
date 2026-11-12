import { useQuery } from '@tanstack/react-query'
import { api } from '@/v2/api'

export interface SystemWarning {
  key: string
  title: string
  body: string
  action: { label: string; to: string }
}

/** Serious box problems. Read-only on purpose: the server clears them when the cause is gone. */
export const useSystemWarnings = () =>
  useQuery({ queryKey: ['system-warnings'], queryFn: () => api<{ items: SystemWarning[] }>('/system/warnings'), refetchInterval: 60_000 })
