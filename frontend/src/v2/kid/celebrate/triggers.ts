import { useCallback, useEffect, useRef } from 'react'
import type { KidChore, KidToday } from '../../types'
import type { CelebrateEvent } from './plan'

/**
 * Client-side triggers (spec Settled 1). What this device last saw is kept in localStorage,
 * so an approval made while the kid was away plays the next time they open the app.
 */
export interface Track {
  /** run id -> last state seen ('mine' = the kid just tapped done here) */
  runs: Record<string, string>
  /** ends_at of the last Happy Hour announced */
  hh: string | null
  /** ends_at of the Happy Hour whose first chore already got the big show */
  hhFirst: string | null
  streak: number
  level: number
}

const MILESTONES = [3, 7, 14, 30]
export const isMilestone = (n: number) => MILESTONES.includes(n) || (n > 30 && n % 30 === 0)

/** Compare today's payload with what this device saw last. First ever look seeds quietly. */
export function detect(prev: Track | null, d: KidToday): { events: CelebrateEvent[]; next: Track } {
  const events: CelebrateEvent[] = []
  const runs: Record<string, string> = {}
  const approved: KidChore[] = []
  for (const c of d.chores) {
    const was = prev?.runs[c.id]
    runs[c.id] = c.state
    if (prev && c.state === 'done' && was !== 'done' && was !== 'mine' && !c.taken_by) approved.push(c)
  }
  if (approved.length)
    events.push({
      kind: 'approve',
      key: `a:${approved.map((c) => c.id).join(',')}`,
      title: approved.length === 1 ? approved[0].title : `${approved.length} chores approved!`,
      points: approved.reduce((n, c) => n + (c.points_now ?? c.points), 0),
    })
  const hh = d.happy_hour?.ends_at ?? null
  if (hh && hh !== prev?.hh) events.push({ kind: 'happy_hour', key: `h:${hh}`, title: 'HAPPY HOUR!' })
  const streak = d.progress?.streak ?? prev?.streak ?? 0
  if (prev && streak > prev.streak && isMilestone(streak))
    events.push({ kind: 'streak', key: `k:${streak}`, title: `${streak}-day streak!`, big: true })
  const level = d.progress?.level ?? prev?.level ?? 0
  if (prev && prev.level > 0 && level > prev.level) events.push({ kind: 'level', key: `l:${level}`, title: `Level ${level}!`, big: true })
  return { events, next: { runs, hh: hh ?? prev?.hh ?? null, hhFirst: prev?.hhFirst ?? null, streak, level } }
}

/** The kid's own "I'm done" tap. The first chore of a Happy Hour is a big moment. */
export function submitEvent(t: Track, c: KidChore, d: KidToday): { event: CelebrateEvent; next: Track } {
  const hh = d.happy_hour?.ends_at ?? null
  const big = !!hh && t.hhFirst !== hh
  return {
    event: { kind: 'submit', key: `s:${c.id}:${c.attempt ?? 1}`, title: c.title, points: c.points_now ?? c.points, big },
    next: { ...t, runs: { ...t.runs, [c.id]: 'mine' }, hhFirst: hh ?? t.hhFirst },
  }
}

const KEY = (kidId: number | null | undefined) => `t4c-celebrate-${kidId ?? 'me'}`
function load(kidId: number | null | undefined): Track | null {
  try {
    const raw = localStorage.getItem(KEY(kidId))
    return raw ? (JSON.parse(raw) as Track) : null
  } catch {
    return null
  }
}
function save(kidId: number | null | undefined, t: Track) {
  try {
    localStorage.setItem(KEY(kidId), JSON.stringify(t))
  } catch {
    /* private mode: celebrations still play this session */
  }
}

/**
 * Watches /kid/today and fires each new moment once. Returns the handler for the kid's own done tap.
 * Off in parent preview (enabled = false).
 */
export function useCelebrationTriggers(d: KidToday, kidId: number | null | undefined, fire: (e: CelebrateEvent) => void, enabled: boolean) {
  const track = useRef<Track | null | undefined>(undefined) // undefined: not loaded yet
  useEffect(() => {
    if (!enabled) return
    if (track.current === undefined) track.current = load(kidId)
    const { events, next } = detect(track.current, d)
    track.current = next
    save(kidId, next)
    events.forEach(fire)
  }, [d, kidId, enabled, fire])
  return useCallback(
    (c: KidChore) => {
      if (!enabled) return
      const t = track.current ?? load(kidId) ?? detect(null, d).next
      const { event, next } = submitEvent(t, c, d)
      track.current = next
      save(kidId, next)
      fire(event)
    },
    [d, kidId, enabled, fire],
  )
}
