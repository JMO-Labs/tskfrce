/** GET /recap: one Monday-Sunday week. */
export type FlagKind = 'catches' | 'dropping' | 'later' | 'streak_ended'
export type FlagAction = 'happy_hour' | 'kid' | 'trust'

/** The numbers each flag fired on, over the same windows the backend rule uses. */
export type RecapFlag = { text: string; action: FlagAction } & (
  | { kind: 'catches' | 'streak_ended'; count: number }
  | { kind: 'dropping' | 'later'; now: number; was: number }
)

export interface RecapKid {
  id: number
  name: string
  flags: RecapFlag[]
  done: number
  /** chores done in each of the 5 weeks up to and including this one, oldest first */
  done_trend: number[]
  on_time_pct: number | null
  on_time_avg: number | null
  points_earned: number
  points_spent: number
  screen_minutes_bought: number
  streak: number
  enough_history: boolean
}

export interface Recap {
  week_start: string
  week_end: string
  prev: string | null
  next: string | null
  kids: RecapKid[]
  family_line: string | null
  all_good: boolean
}

/** Seriousness, most serious first: the order backend recap_flags.flags() emits them in. */
export const FLAG_RANK: Record<FlagKind, number> = { catches: 0, dropping: 1, later: 2, streak_ended: 3 }

export interface Look {
  kid: RecapKid
  flag: RecapFlag
}

/** Every flag of every kid, most serious first; ties keep kid and backend order. */
export const looksOf = (kids: RecapKid[]): Look[] =>
  kids.flatMap((kid) => kid.flags.map((flag) => ({ kid, flag }))).sort((a, b) => FLAG_RANK[a.flag.kind] - FLAG_RANK[b.flag.kind])

/** Mean of the 4 weeks before this one, rounded; null with no history. */
export const avgDone = (k: RecapKid): number | null => {
  const w = k.done_trend.slice(0, -1).slice(-4)
  return w.length ? Math.round(w.reduce((a, b) => a + b, 0) / w.length) : null
}

/** Icon, title (after "Name: ") and muted line for a flag. */
export function lookText({ flag }: Look): { icon: string; title: string; sub: string } {
  switch (flag.kind) {
    case 'catches':
      return { icon: 'undo', title: `${flag.count} needed another go`, sub: 'Spot check, wasn’t done' }
    case 'dropping':
      return { icon: 'trending_down', title: 'fewer chores', sub: `${flag.now} a week, was ${flag.was}` }
    case 'later':
      return { icon: 'schedule', title: 'finishing later', sub: `On time ${flag.now}%, was ${flag.was}%` }
    case 'streak_ended':
      return { icon: 'local_fire_department', title: `${flag.count}-day streak ended`, sub: 'This week' }
  }
}
