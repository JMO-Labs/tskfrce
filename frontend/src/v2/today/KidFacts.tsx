import type { TodayKid } from '../types'
import { useClock } from './useClock'

/** First letter, whole code point (an emoji name must not be cut into half a surrogate pair). */
export const initial = (name: string | null) => (Array.from(name?.trim() ?? '')[0] ?? '?').toUpperCase()

const streakText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

/** Schedule end time; "Locked" when the kid's devices are already off. */
const locksAt = (kid: TodayKid, clock: (iso: string) => string) => {
  if (kid.locks_at) return clock(kid.locks_at)
  return kid.devices.length && !kid.devices.some((d) => d.online) ? 'Locked' : '—'
}

/** Streak / last active / next reward / locks-at: the Today avatar pop-over and the chat side panel. */
export function KidFacts({ kid }: { kid: TodayKid }) {
  const clock = useClock()
  return (
    <div className="p-kid-facts">
      <div>
        <span>Streak</span>
        <b>{streakText(kid.progress?.streak ?? 0)}</b>
      </div>
      <div>
        <span>Last active</span>
        <b>{kid.last_active ? clock(kid.last_active) : '—'}</b>
      </div>
      <div>
        <span>Next reward</span>
        <b>{kid.next_reward != null ? `${kid.next_reward} pts` : '—'}</b>
      </div>
      <div>
        <span>Locks at</span>
        <b>{locksAt(kid, clock)}</b>
      </div>
    </div>
  )
}
