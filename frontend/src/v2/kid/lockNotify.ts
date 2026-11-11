import { useEffect, useRef } from 'react'
import type { KidToday } from '../types'

export interface LockNote {
  /** the lock reason; a new notification fires only when this changes */
  kind: string
  title: string
  body: string
}

const fmt = (iso: string, tz?: string) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz })
  } catch {
    return ''
  }
}

/** Why the device is blocked and what unlocks it; null when it isn't blocked. */
export function lockNote(d: KidToday): LockNote | null {
  if (!d.locked) return null
  const kind = d.lock_reason || 'schedule'
  const title = 'Internet is paused'
  const until = d.lock_until ? fmt(d.lock_until, d.timezone) : ''
  const todo = d.chores.filter((c) => c.state === 'todo').length
  let body: string
  if (kind === 'chores') body = todo ? `${todo} ${todo === 1 ? 'chore' : 'chores'} left to turn it on` : 'Finish your chores to turn it on'
  else if (kind === 'manual') body = until ? `A parent paused it until ${until}` : 'A parent paused it'
  else if (kind === 'penalty') body = until ? `Paused until ${until}` : 'Paused for now'
  else if (kind === 'new_device') body = 'A parent needs to approve this device'
  else body = 'It comes back on in your allowed hours'
  return { kind, title, body }
}

function pop(note: LockNote, open: () => void): void {
  const opts = { body: note.body, tag: 'lock', data: { url: '/kid' } }
  const legacy = () => {
    try {
      const n = new Notification(note.title, opts)
      n.onclick = () => (window.focus(), open(), n.close())
    } catch {
      /* some mobile browsers only allow service worker notifications */
    }
  }
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  if (!sw?.ready) return legacy()
  try {
    sw.ready.then((r) => r.showNotification(note.title, opts)).catch(legacy)
  } catch {
    legacy()
  }
}

/** One OS notification per lock (not per poll), with the reason. Tapping it opens /kid. */
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
    pop(note, open)
  }, [d, open, on])
}
