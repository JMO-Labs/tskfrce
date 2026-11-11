import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/v2/api'
import type { Recap } from '@/v2/recap/recapTypes'

/** The weekly recap; no `week` means the latest finished week. */
export const useRecap = (week?: string) =>
  useQuery({
    queryKey: ['recap', week ?? 'latest'],
    queryFn: () => api<Recap>(week ? `/recap?week=${week}` : '/recap'),
    placeholderData: keepPreviousData,
  })
