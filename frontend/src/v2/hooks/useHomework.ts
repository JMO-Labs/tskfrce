import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export interface HomeworkActivityItem {
  domain: string
  via: 'list' | 'follow'
  pulled_by?: string | null
  active_minutes: number
  last_seen: string
}

export interface HomeworkActivitySession {
  device_id: number
  device_name: string
  kid_id?: number | null
  kid_name?: string | null
  session_start: string
  active: boolean
  until?: string
  items: HomeworkActivityItem[]
}

export function useHomeworkActivity({ deviceId, kidId }: { deviceId?: number; kidId?: number } = {}) {
  const query = deviceId ? `?device_id=${deviceId}` : kidId ? `?kid_id=${kidId}` : ''
  return useQuery({
    queryKey: ['homework-activity', deviceId, kidId],
    queryFn: () => api(`/homework/activity${query}`) as Promise<HomeworkActivitySession[]>,
    refetchInterval: 15000, // Refetch every 15 seconds
  })
}

export interface SiteIn {
  domain: string
  kind: 'allow' | 'block'
  kid_id?: number | null
}

export function useHomeworkSite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ action, domain, kind, kid_id }: { action: 'add' | 'remove'; domain: string; kind: 'allow' | 'block'; kid_id?: number | null }) =>
      api('/homework/sites', {
        method: action === 'add' ? 'POST' : 'DELETE',
        body: { domain, kind, kid_id },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['homework-sites'] })
      qc.invalidateQueries({ queryKey: ['homework-activity'] })
    },
  })
}
