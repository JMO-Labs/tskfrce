import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'

export interface NetworkRow {
  id: number
  iface: string
  subnet: string
  label: string
  auto_label: string
  custom_label: string | null
  enforce: boolean
  last_seen: string
}
export type NetworkPatch = { custom_label?: string | null; enforce?: boolean }

const KEY = ['networks']

export const useNetworks = () => useQuery({ queryKey: KEY, queryFn: () => api<NetworkRow[]>('/networks') })

/** PATCH one network; the list updates at once and rolls back if the box refuses. */
export function usePatchNetwork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: NetworkPatch & { id: number }) => api<NetworkRow>(`/networks/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<NetworkRow[]>(KEY)
      qc.setQueryData<NetworkRow[]>(KEY, (rows) =>
        rows?.map((n) => {
          if (n.id !== id) return n
          const next = { ...n, ...patch }
          if ('custom_label' in patch) next.label = patch.custom_label || n.auto_label
          return next
        }),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => qc.setQueryData(KEY, ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Chip labels for devices: null for every device unless the box sees 2+ networks. */
export function useNetworkLabels() {
  const nets = useNetworks().data
  const rows = Array.isArray(nets) ? nets : []
  const multi = rows.length >= 2
  return { networks: multi ? rows : [], labelFor: (d: { network_id?: number | null }) => (multi && d.network_id != null ? rows.find((n) => n.id === d.network_id)?.label ?? null : null) }
}

/** Devices on the chosen network; '' (All) keeps everything, incl. devices with no network. */
export const filterByNetwork = <T extends { network_id?: number | null }>(list: T[], net: string) => (net ? list.filter((d) => String(d.network_id ?? '') === net) : list)
