import { useQuery } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { useInvalidating } from './useRewards'
import type { AuditRow, CatalogItem, InstallBody, InstallDetail, InstallOut } from '@/v2/integrations/types'

const KEYS = ['integrations', 'today', 'rewards']

export const useCatalog = () =>
  useQuery({ queryKey: ['integrations', 'catalog'], queryFn: () => api<CatalogItem[]>('/integrations/catalog') })

export const useInstalls = () => useQuery({ queryKey: ['integrations'], queryFn: () => api<InstallOut[]>('/integrations') })

export const useInstall = (id: number) =>
  useQuery({ queryKey: ['integrations', id], queryFn: () => api<InstallDetail>(`/integrations/${id}`) })

export const useInstallIntegration = () =>
  useInvalidating((body: InstallBody) => api<InstallOut>('/integrations', { method: 'POST', body }), KEYS)

export const usePatchIntegration = (id: number) =>
  useInvalidating(
    (body: { kid_widget_ids?: number[]; trusted?: boolean; resume?: boolean }) =>
      api<InstallOut>(`/integrations/${id}`, { method: 'PATCH', body }),
    KEYS,
  )

export const useRemoveIntegration = (id: number) =>
  useInvalidating(() => api(`/integrations/${id}`, { method: 'DELETE' }), KEYS)

export const useIntegrationLog = (id: number) =>
  useQuery({ queryKey: ['integrations', id, 'log'], queryFn: () => api<AuditRow[]>(`/integrations/${id}/log`) })
