import { Icon } from '@/v2/parent/Icon'
import { useEvalStatus } from './useEvalStatus'

export const NOTICE = {
  title: 'This is an evaluation kit',
  lines: [
    'This t@sk4ce box is a test version, lent to you by the person who set it up. It sends them anonymous usage counts so they can make it better.',
    "What's sent: which screens are opened, setup steps finished, daily counts of chores and locks, error types, and each kid's age range.",
    'Never sent: names, usernames, chat or note text, device names, network addresses or your location.',
    'Feedback is only sent when you press Send.',
  ],
}

/** What an evaluation kit sends. Only shown when the box has stats on. */
export function EvalNotice() {
  const { data, loading } = useEvalStatus()
  if (loading || !data.stats) return null
  return (
    <section aria-label={NOTICE.title} className="f-card m-card" style={{ marginTop: 16 }}>
      <h2 className="f-display" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
        <Icon name="query_stats" size={22} />
        {NOTICE.title}
      </h2>
      {NOTICE.lines.map((l) => (
        <p key={l} className="m-help" style={{ fontSize: 14 }}>{l}</p>
      ))}
    </section>
  )
}
