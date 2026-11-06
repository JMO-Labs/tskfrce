import type { CelebrateLevel } from '../../types'
import type { KidAge } from '../modes/types'
import { activeSeason, mascotsFor } from './catalog'
import { pickCombo, type Combo, type Rng } from './pick'

export interface CelebrateEvent {
  kind: 'submit' | 'approve' | 'happy_hour' | 'streak' | 'level'
  /** unique per moment, so a trigger never plays twice */
  key: string
  /** the card's line ("Dishes", "Level 3!") */
  title: string
  points?: number
  /** level up, streak milestone, first chore of a Happy Hour: always a mascot */
  big?: boolean
  /** the chore run whose tile gets the card effect */
  runId?: number
}

export interface PlanCtx {
  level: CelebrateLevel
  mode: KidAge
  reduced: boolean
  rng: Rng
  last: Combo | null
  kidLevel: number
  date: Date
}

export interface Show {
  event: CelebrateEvent
  /** full: the comic moment; small: card pop and tag; static: reduced-motion badge */
  kind: 'full' | 'small' | 'static'
  combo: Combo | null
  mode: KidAge
}

/** The "+N ✓" line for the static badge (or the title when there are no points). */
export const badgeText = (e: CelebrateEvent) => (e.points != null ? `+${e.points} ✓` : `${e.title} ✓`)

/** Decide what an event looks like for this kid (level, mode, reduced motion) and pick a fresh combination. */
export function planShow(event: CelebrateEvent, c: PlanCtx): Show | null {
  if (c.level === 'off') return null
  if (c.reduced) return { event, kind: 'static', combo: null, mode: c.mode }
  if (c.level === 'small') return { event, kind: 'small', combo: null, mode: c.mode }
  const season = activeSeason(c.date)
  const combo = pickCombo(c.rng, c.last, {
    mascots: mascotsFor(c.kidLevel, c.date),
    words: season?.words,
    wantMascot: true,
    forceMascot: !!event.big || c.mode === 'little',
    cards: c.mode === 'little' ? ['pop', 'wiggle', 'stamp'] : undefined, // "Do this now" never leaves the screen
  })
  return { event, kind: 'full', combo, mode: c.mode }
}
