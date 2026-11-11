import { useEffect, useRef } from 'react'
import type { KidToday } from '../types'

export interface LockNote {
  /** what the lock is about; a new notification fires only when this changes */
  kind: 'chores' | 'hours'
  title: string
  body: string
}

/** Why the device is blocked and what unlocks it; null when it isn't blocked. */
export function lockNote(d: KidToday): LockNote | null {
  if (!d.locked) return null
  const todo = d.chores.filter((c) => c.state === 'todo').length
  if (todo) return { kind: 'chores', title: 'Internet is paused', body: `${todo} ${todo === 1 ? 'chore' : 'chores'} left to turn it on` }
  return { kind: 'hours', title: 'Internet is paused', body: 'It comes back on in your allowed hours' }
}

/** One OS notification per lock (not per poll), with the reason. Tapping it calls open. */
export function useLockNotify(d: KidToday | undefined, open: () => void, on = true): void {
  const last = useRef<{ kind: string | null; primed: boolean }>({ kind: null, primed: false })
  useEffect(() => {
    if (!d || !on) return
    const note = lockNote(d)
    const st = last.current
    const prev = st.kind
    st.kind = note?.kind ?? null
    if (!st.primed) return void (st.primed = true) // already locked on load isn't news
    if (!note || note.kind === prev) return
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return
    const pop = new Notification(note.title, { body: note.body, tag: 'lock' })
    pop.onclick = () => (window.focus(), open(), pop.close())
  }, [d, open, on])
}
