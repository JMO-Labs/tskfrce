import type { KidChore, KidToday } from '../types'

type HH = KidToday['happy_hour']

/** Whole seconds left in a Happy Hour (0 = none or over). */
export const hhLeft = (hh: HH | undefined, now: number) => (hh ? Math.max(0, Math.ceil((Date.parse(hh.ends_at) - now) / 1000)) : 0)

export function mmss(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`
}

/** Doubled points for a tile: only while the Happy Hour runs and the server says more than base. */
export const boosted = (c: KidChore, hh: HH | undefined, now: number) =>
  hhLeft(hh, now) > 0 && c.points_now != null && c.points_now > c.points ? c.points_now : undefined
