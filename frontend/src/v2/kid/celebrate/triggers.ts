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
  /** trust level (0-2) last seen; null = trust mode off */
  trust?: number | null
}

const MILESTONES = [3, 7, 14, 30]
export const isMilestone = (n: number) => MILESTONES.includes(n) || (n > 30 && n % 30 === 0)

/**
 * Compare today's payload with what this device saw last. First ever look seeds quietly.
 * inflight: runs whose done request has not answered yet (they keep their 'mine' mark).
 */
export function detect(prev: Track | null, d: KidToday, now = Date.now(), inflight: ReadonlySet<number> = new Set()): { events: CelebrateEvent[]; next: Track } {
  const events: CelebrateEvent[] = []
  const runs: Record<string, string> = {}
  const approved: KidChore[] = []
  for (const c of d.chores) {
    const was = prev?.runs[c.id]
    // a poll before the tap's request lands keeps 'mine'; back at todo with nothing in flight (rejected) clears it
    runs[c.id] = was === 'mine' && c.state === 'todo' && inflight.has(c.id) ? 'mine' : c.state
    if (prev && c.state === 'done' && was !== 'done' && was !== 'mine' && !c.taken_by) approved.push(c)
  }
  if (approved.length)
    events.push({
      kind: 'approve',
      key: `a:${approved.map((c) => c.id).join(',')}`,
      runId: approved[0].id,
      title: approved.length === 1 ? approved[0].title : `${approved.length} chores approved!`,
      points: approved.reduce((n, c) => n + (c.points_now ?? c.points), 0),
    })
  const hh = d.happy_hour?.ends_at ?? null
  // a new Happy Hour, not one already running on the first look, nor an extension of one still going
  if (prev && hh && hh !== prev.hh && (!prev.hh || Date.parse(prev.hh) <= now))
    events.push({ kind: 'happy_hour', key: `h:${hh}`, title: 'HAPPY HOUR!' })
  const streak = d.progress?.streak ?? prev?.streak ?? 0
  if (prev && streak > prev.streak && isMilestone(streak))
    events.push({ kind: 'streak', key: `k:${streak}`, title: `${streak}-day streak!`, big: true })
  const level = d.progress?.level ?? prev?.level ?? 0
  if (prev && prev.level > 0 && level > prev.level) events.push({ kind: 'level', key: `l:${level}`, title: `Level ${level}!`, big: true })
  const trust = d.trust?.level ?? null
  // a raise since last seen (also on the next open); older stored tracks have no trust field and seed quietly
  if (prev && prev.trust != null && trust != null && trust > prev.trust)
    events.push({ kind: 'level', key: `t:${trust}`, title: `You're ${['New', 'Trusted', 'Proven'][trust]}!`, big: true })
  return { events, next: { runs, hh: hh ?? prev?.hh ?? null, hhFirst: prev?.hhFirst ?? null, streak, level, trust } }
}

/** The kid's own "I'm done" tap. The first chore of a Happy Hour is a big moment. */
export function submitEvent(t: Track, c: KidChore, d: KidToday, now = Date.now()): { event: CelebrateEvent; next: Track } {
  const hh = d.happy_hour?.ends_at ?? null
  const big = !!hh && t.hhFirst !== hh
  return {
    event: { kind: 'submit', key: `s:${c.id}:${now}`, title: c.title, points: c.points_now ?? c.points, big, runId: c.id },
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

export interface SubmitHandlers {
  /** the tap, before the request goes out: marks the run as the kid's own. false = a duplicate, send nothing */
  tap: (c: KidChore) => boolean
  /** the request went through: play it (once) */
  sent: (c: KidChore) => void
  /** the request failed: forget the mark */
  failed: (c: KidChore) => void
}

/**
 * Watches /kid/today and fires each new moment once. Returns the handlers for the kid's own done tap.
 * Off in parent preview (enabled = false).
 */
export function useCelebrationTriggers(d: KidToday, kidId: number | null | undefined, fire: (e: CelebrateEvent) => void, enabled: boolean): SubmitHandlers {
  const track = useRef<Track | null | undefined>(undefined) // undefined: not loaded yet
  const pending = useRef(new Map<number, { event: CelebrateEvent; was?: string; hhFirst: string | null }>())
  useEffect(() => {
    if (!enabled) return
    if (track.current === undefined) track.current = load(kidId)
    const { events, next } = detect(track.current, d, Date.now(), new Set(pending.current.keys()))
    track.current = next
    save(kidId, next)
    events.forEach(fire)
  }, [d, kidId, enabled, fire])
  const tap = useCallback(
    (c: KidChore) => {
      if (!enabled) return true
      if (pending.current.has(c.id)) return false // a double tap
      const t = track.current ?? load(kidId) ?? detect(null, d).next
      const { event, next } = submitEvent(t, c, d)
      pending.current.set(c.id, { event, was: t.runs[c.id], hhFirst: t.hhFirst })
      track.current = next
      save(kidId, next)
      return true
    },
    [d, kidId, enabled],
  )
  const sent = useCallback(
    (c: KidChore) => {
      const p = pending.current.get(c.id)
      if (!p) return
      pending.current.delete(c.id)
      fire(p.event)
    },
    [fire],
  )
  const failed = useCallback(
    (c: KidChore) => {
      const p = pending.current.get(c.id)
      if (!p || !track.current) return
      pending.current.delete(c.id)
      const runs = { ...track.current.runs }
      if (p.was === undefined) delete runs[c.id]
      else runs[c.id] = p.was
      track.current = { ...track.current, runs, hhFirst: p.hhFirst }
      save(kidId, track.current)
    },
    [kidId],
  )
  return { tap, sent, failed }
}
