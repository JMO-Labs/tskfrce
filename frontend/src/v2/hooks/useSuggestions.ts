import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/v2/api'

export interface Suggestion {
  key: string
  rule: string
  /** 0 system, 1 kid-impacting, 2 growth */
  tier: number
  fingerprint: string
  at: string
  title: string
  body: string
  action: { kind: string; label: string; to: string }
}

export interface SuggestionsResponse {
  hidden: boolean
  items: Suggestion[]
}

const KEY = ['suggestions']

export const useSuggestions = () => useQuery({ queryKey: KEY, queryFn: () => api<SuggestionsResponse>('/suggestions') })

/** Every suggestion write refetches the list; the server owns dismiss/mute/hide state. */
function useSuggestionWrite<V = void>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) })
}

export const useDismissSuggestion = () =>
  useSuggestionWrite((s: Pick<Suggestion, 'key' | 'fingerprint'>) =>
    api('/suggestions/dismiss', { method: 'POST', body: { key: s.key, fingerprint: s.fingerprint } }),
  )
export const useMuteSuggestion = () => useSuggestionWrite((rule: string) => api('/suggestions/mute', { method: 'POST', body: { rule } }))
export const useHideSuggestions = () => useSuggestionWrite(() => api('/suggestions/hide', { method: 'POST' }))
export const useShowSuggestions = () => useSuggestionWrite(() => api('/suggestions/hide', { method: 'DELETE' }))
export const useResetMuted = () => useSuggestionWrite(() => api('/suggestions/muted', { method: 'DELETE' }))
