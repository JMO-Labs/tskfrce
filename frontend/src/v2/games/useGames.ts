import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { blocked, kidInit, useAsKid } from '../hooks/usePreview'
import type { CelebrateLevel } from '../types'
import type { FinishBody, FinishResult, GamesShelf, StartedPlay } from './types'

const SHELF = ['kid', 'games'] as const

export const useGamesShelf = (enabled = true) => {
  const as = useAsKid()
  return useQuery({
    queryKey: [...SHELF, as],
    queryFn: () => api<GamesShelf>('/kid/games', kidInit(as)),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    enabled,
  })
}

/** Errors stay with the caller (shown on the shelf as a kid hint). */
function useKidPost<B, R>(path: string, also: string[][] = []) {
  const qc = useQueryClient()
  const as = useAsKid()
  return useMutation({
    mutationFn: (body: B) => (as ? blocked() : api<R>(path, { method: 'POST', kid: true, body })) as Promise<R>,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [...SHELF] })
      also.forEach((k) => qc.invalidateQueries({ queryKey: k }))
    },
  })
}

export const useStartGame = () => useKidPost<Record<string, never>, StartedPlay>('/kid/games/start')
export const useFinishGame = () => useKidPost<FinishBody, FinishResult>('/kid/games/finish', [['kid', 'today']])
export const useGamesSeen = () => useKidPost<Record<string, never>, void>('/kid/games/seen', [['kid', 'today']])

/** True when decorative motion (mascot entry, wheel spin, star pop) should be skipped. */
export const reduceDecor = (celebrate: CelebrateLevel) =>
  celebrate === 'off' || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
