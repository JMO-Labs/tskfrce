import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { toastFail, toastOk } from '@/v2/notify'

export interface WifiNetwork {
  ssid: string
  signal: number
  security: 'open' | 'wpa' | 'sae'
  hidden?: boolean
}

export interface WifiStatus {
  current_ssid: string | null
  signal_strength: number | null
  is_connected: boolean
}

export const useWifiStatus = () =>
  useQuery({
    queryKey: ['wifi', 'status'],
    queryFn: () => api<WifiStatus>('/v1/network/wifi/status'),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })

export const useWifiScan = () =>
  useQuery({
    queryKey: ['wifi', 'scan'],
    queryFn: () => api<WifiNetwork[]>('/v1/network/wifi/scan'),
    enabled: false,
    staleTime: 30_000,
  })

export const useWifiJoin = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ssid, password, security, hidden }: { ssid: string; password?: string; security: string; hidden?: boolean }) =>
      api('/v1/network/wifi/join', {
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
    mutationFn: () => api('/v1/network/wifi/forget', { method: 'POST' }),
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
      api(`/v1/network/wifi/country`, { method: 'POST', body: { country } }),
    onSuccess: () => {
      toastOk('Region updated')
      qc.invalidateQueries({ queryKey: ['wifi'] })
    },
    onError: (e) => toastFail(e),
  })
}
