import { useQuery } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { useInvalidating } from './useRewards'
import type { AuditRow, LocalKeyBody, CatalogItem, InstallBody, InstallDetail, InstallOut, PermissionOut } from '@/v2/integrations/types'

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

export const useLocalPermissions = () =>
  useQuery({ queryKey: ['integrations', 'local-perms'], queryFn: () => api<PermissionOut[]>('/integration-local/permissions') })

/** gcTime 0: the one-time token in the reply must not linger in the mutation cache. */
export const useCreateLocalKey = () =>
  useInvalidating(
    (body: LocalKeyBody) => api<{ id: number; token: string }>('/integration-local/keys', { method: 'POST', body }),
    ['integrations'],
    0,
  )
