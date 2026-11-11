import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'

export interface SetupWifiStatus {
  phase: 'idle' | 'connecting' | 'connected' | 'failed'
  error?: 'wrong_password' | 'failed'
  ssid?: string
}

export const useSetupWifiStatus = (enabled = true) => {
  const [shouldPoll, setShouldPoll] = useState(enabled)
  const query = useQuery({
    queryKey: ['setup', 'wifi', 'status'],
    queryFn: () => api<SetupWifiStatus>('/network/wifi/setup/status'),
    enabled: shouldPoll,
    refetchInterval: shouldPoll ? 2_000 : false,
  })

  useEffect(() => {
    if (query.data?.phase === 'connected' || query.data?.phase === 'failed') {
      const timer = setTimeout(() => setShouldPoll(false), 0)
      return () => clearTimeout(timer)
    }
  }, [query.data?.phase])

  return query
}

export const useSetupWifiJoin = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ssid, password, security, hidden }: { ssid: string; password?: string; security: string; hidden?: boolean }) =>
      api('/network/wifi/setup/join', {
        method: 'POST',
        body: { ssid, password, security, hidden },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup', 'wifi'] }),
  })
}

export const useSetupWifiScan = () =>
  useQuery({
    queryKey: ['setup', 'wifi', 'scan'],
    queryFn: async () =>
      (await api<{ networks: Array<{ ssid: string; signal: number; security: string }> }>('/network/wifi/setup/scan')).networks,
    staleTime: 30_000,
  })
