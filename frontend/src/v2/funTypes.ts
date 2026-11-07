/** Excitement-pack types: Happy Hour and celebrations (split from types.ts). */

/** GET/POST /happy-hour item */
export interface HappyHour {
  id: number
  starts_at: string
  ends_at: string
  multiplier: number
  mult_x10: 15 | 20 | 30
  source: 'parent' | 'schedule' | 'auto'
  kid_ids: number[] | null
}

export type CelebrateLevel = 'full' | 'small' | 'off'

/** GET /kid/celebrations item. key: "r:<id>" | "b:<id>" | "l:<level>". */
export interface KidCelebration {
  key: string
  kind: 'reward' | 'screen_time' | 'badge' | 'level' | 'bonus'
  title: string
  /** badge: tier name; bonus: the parent's note */
  detail: string
  /** custom badge: the parent's note */
  note?: string | null
  size: 'big' | 'small'
  glyph?: string | null
  /** level celebrations: flair newly unlocked */
  unlocked?: { id: string; label: string; emblem: string | null }[]
}
