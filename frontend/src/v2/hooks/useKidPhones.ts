import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'
import type { KidPhone } from '@/v2/types/enroll'

/** A kid's signed-in phones and tablets. */
export const useKidPhones = (kidId: number, pollMs: number | false = false) =>
  useQuery({ queryKey: ['kid-phones', kidId], queryFn: () => api<KidPhone[]>(`/kids/${kidId}/phones`), refetchInterval: pollMs })

/** Sign one phone out right away, then refresh the list. */
export function useRemoveKidPhone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kidId, phoneId }: { kidId: number; phoneId: number }) => api(`/kids/${kidId}/phones/${phoneId}`, { method: 'DELETE' }),
    onSuccess: (_d, { kidId }) => qc.invalidateQueries({ queryKey: ['kid-phones', kidId] }),
  })
}
