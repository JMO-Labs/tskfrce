import { useMutation } from '@tanstack/react-query'
import { api } from '@/v2/api'
import type { EnrollCode } from '@/v2/types/enroll'

/** Make a fresh sign-in code for a kid's phone (each one voids the last). */
export const useEnrollCode = () =>
  useMutation({ mutationFn: (kidId: number) => api<EnrollCode>(`/kids/${kidId}/enroll`, { method: 'POST' }) })
