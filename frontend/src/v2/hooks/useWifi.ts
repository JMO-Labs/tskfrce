import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { toastFail, toastOk } from '@/v2/notify'

export interface WifiNetwork {
  ssid: string
  signal: number
  security: 'open' | 'wpa' | 'sae'
  hidden?: boolean
}

/** Mirrors tskfrce-netd `status` (backend passes it through unchanged). */
export interface WifiStatus {
  online: boolean
  connected: boolean
  ssid: string | null
  signal: number
  hotspot_active: boolean
  country: string | null
}

export const useWifiStatus = () =>
  useQuery({
    queryKey: ['wifi', 'status'],
    queryFn: () => api<WifiStatus>('/network/wifi/status'),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })

export const useWifiScan = () =>
  useQuery({
    queryKey: ['wifi', 'scan'],
    queryFn: async () => (await api<{ networks: WifiNetwork[] }>('/network/wifi/scan', { method: 'POST' })).networks,
    enabled: false,
    staleTime: 30_000,
  })

export const useWifiJoin = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ssid, password, security, hidden }: { ssid: string; password?: string; security: string; hidden?: boolean }) =>
      api('/network/wifi/join', {
        method: 'POST',
        body: { ssid, password, security, hidden },
      }),
    onSuccess: () => {
      toastOk('Connecting...')
      qc.invalidateQueries({ queryKey: ['wifi'] })
    },
    onError: (e) => toastFail(e),
  })
}

export const useWifiForget = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ssid: string) => api('/network/wifi/forget', { method: 'POST', body: { ssid } }),
    onSuccess: () => {
      toastOk('Network forgotten')
      qc.invalidateQueries({ queryKey: ['wifi'] })
    },
    onError: (e) => toastFail(e),
  })
}

export const useWifiCountry = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (country: string) =>
      api(`/network/wifi/country`, { method: 'POST', body: { country } }),
    onSuccess: () => {
      toastOk('Region updated')
      qc.invalidateQueries({ queryKey: ['wifi'] })
    },
    onError: (e) => toastFail(e),
  })
}
