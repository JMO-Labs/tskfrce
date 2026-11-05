import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { toastFail, toastOk } from '@/v2/notify'
import type { Surface, WidgetGroup } from '@/v2/integrations/types'

const KEY = 'integration-widgets'

export const useIntegrationWidgets = (surface: Surface) =>
  useQuery({
    queryKey: [KEY, surface],
    queryFn: () => api<WidgetGroup[]>(`/integration-widgets?surface=${surface}`, { kid: surface === 'kid' }),
    staleTime: 60_000,
  })

interface Press {
  widget_id: string
  button_id: string
}

/** Press a widget button. The box clears its cache on press, so that install's widgets are refetched. */
export function usePressButton(installId: number, surface: Surface) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Press) =>
      api<{ result: string; reason: string | null }[]>(`/integration-widgets/${installId}/press`, {
        method: 'POST',
        body,
        kid: surface === 'kid',
      }),
    onSuccess: (results) => {
      for (const r of results) {
        if (r.result === 'applied') toastOk('Done.')
        else if (r.result === 'pending') toastOk(surface === 'kid' ? 'Asked.' : 'Sent to Needs you.')
        else toastFail(new Error(r.reason || "That didn't work."))
      }
    },
    onError: toastFail,
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, surface] }),
  })
}
