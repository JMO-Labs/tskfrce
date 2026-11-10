import type { AgeGroup } from '../types'

/** Mirrors backend games_catalog.py: display only, the server recomputes. */
export const partScore = (ms: number) => 100 + Math.max(0, 50 - Math.floor(ms / 60))

const AGE_EXTRA: Record<AgeGroup, number> = { little: 600, kid: 0, teen: -200 }
/** Time to act on quick-fire game i (0-based). */
export const windowMs = (age: AgeGroup, i: number) => Math.max(1500, 3200 - i * 90) + AGE_EXTRA[age]

/** Microgame level: starts at the age's level, +1 every 4 games, max 5. */
export const microLevel = (start: number, i: number) => Math.min(5, start + Math.floor(i / 4))

export const RUN_MS = 60_000
export const HEARTS = 3

const STARS_AT: Record<string, [number, number, number]> = {
  quickfire: [500, 1100, 1800],
  'hungry-cat': [10, 25, 40],
  'math-dash': [10, 20, 30],
  'pack-the-box': [2, 4, 7],
  'shelf-memory': [8, 16, 28],
}
export const starsFor = (game: string, score: number) => (STARS_AT[game] ?? [Infinity, Infinity, Infinity]).filter((t) => score >= t).length
