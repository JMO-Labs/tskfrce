import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/v2/api'
import type { PresetBody, PresetCatalog, PresetResult } from './types'

export const usePresets = () => useQuery({ queryKey: ['presets'], queryFn: () => api<PresetCatalog>('/presets') })

export const usePreview = (body: PresetBody, enabled = true) =>
  useQuery({ queryKey: ['presets-preview', body], enabled, queryFn: () => api<PresetResult>('/presets/preview', { method: 'POST', body }) })

const REFRESH = ['presets', 'kids', 'family', 'today', 'chore-lib', 'hours', 'screen-time']

export function useApplyPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PresetBody) => api<PresetResult>('/presets/apply', { method: 'POST', body }),
    onSuccess: () => Promise.all(REFRESH.map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}
