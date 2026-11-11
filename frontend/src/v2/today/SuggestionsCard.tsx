import Link from 'next/link'
import { MoreMenu } from '../parent/MoreMenu'
import { Icon } from '../parent/Icon'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { toastFail } from '../notify'
import { useDismissSuggestion, useHideSuggestions, useMuteSuggestion, useSuggestions, type Suggestion } from '../hooks/useSuggestions'

const SYSTEM = 0
const ICONS: Record<number, string> = { 0: 'devices', 1: 'tune', 2: 'lightbulb' }

/** Today's Suggestions card: up to 3 rules over real family state, each with one action. */
export function SuggestionsCard() {
  const { data } = useSuggestions()
  const dismiss = useDismissSuggestion()
  const mute = useMuteSuggestion()
  const hide = useHideSuggestions()
  const qc = useQueryClient()
  const act = useMutation({
    mutationFn: (to: string) => api(to, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  })
  const items = data?.items ?? []
  if (data?.hidden || items.length === 0) return null
  const fail = { onError: toastFail }
  return (
    <section className="pt-sugg" aria-label="Suggestions">
      <header className="pt-sugg-h">
        <h2>Suggestions</h2>
        <MoreMenu label="More for Suggestions" items={[{ label: 'Hide suggestions', icon: 'visibility_off', onClick: () => hide.mutate(undefined, fail) }]} />
      </header>
      <ul className="pt-sugg-l">
        {items.map((s: Suggestion) => (
          <li key={s.key} className="pt-sugg-i">
            <Icon name={ICONS[s.tier] ?? 'lightbulb'} size={18} />
            <div className="pt-sugg-t">
              <b>{s.title}</b>
              <span>{s.body}</span>
              <div className="pt-sugg-a">
                {s.action.kind === 'post' ? (
                  <button type="button" className="p-btn" data-variant="ink" disabled={act.isPending} onClick={() => act.mutate(s.action.to, fail)}>{s.action.label}</button>
                ) : (
                  <Link className="p-btn" data-variant="ink" href={s.action.to}>{s.action.label}</Link>
                )}
                <button type="button" className="p-btn" onClick={() => dismiss.mutate(s, fail)}>Dismiss</button>
                {s.tier !== SYSTEM && (
                  <button type="button" className="p-btn" onClick={() => mute.mutate(s.rule, fail)}>Not for us</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
