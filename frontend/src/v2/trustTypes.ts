export const LEVELS = ['New', 'Trusted', 'Proven'] as const

/** One line under the level picker, per level (spot-check rates: Trusted 1 in 5, Proven 1 in 20). */
export const LEVEL_TEXT = [
  'New: you approve every chore. Chores start approving themselves at Trusted.',
  'Trusted: chores approve themselves. 1 in 5 waits for you as a spot check.',
  'Proven: chores approve themselves. 1 in 20 waits for you as a spot check.',
] as const

/** Trust fields on GET /kids */
export interface KidTrustFields {
  trust_mode?: boolean
  trust_level?: 0 | 1 | 2
  trust_clean?: number
  /** clean chores needed for the next level; null at Proven */
  trust_goal?: number | null
}

/** Trust fields on a chore run (/today chore rows and Needs items) */
export interface RunTrustFields {
  /** run day, YYYY-MM-DD */
  day?: string
  /** who approved it: parent | trust | bedtime */
  approved_via?: string | null
  /** points a Wasn't done would take back (self-approved rows); null = none */
  earned_pts?: number | null
  /** Needs: picked for a parent look */
  spot_check?: boolean
}

export interface ChoreTrustFields {
  always_check?: boolean
}

/** trust mode: 0 New, 1 Trusted, 2 Proven; to_next null at Proven */
export interface KidTrust {
  level: 0 | 1 | 2
  to_next: number | null
  /** chores needed for the next level; null at Proven */
  goal: number | null
}

/** GET /kids/{id}/self-approved: chores that approved themselves in the last 7 days, newest first. */
export interface SelfApproved {
  id: number
  title: string
  /** run day, YYYY-MM-DD */
  day: string
  approved_at: string
  approved_via: 'trust' | 'bedtime'
  points: number
  photos: number
}

/** A chore a parent can say "Wasn't done" about. */
export interface TakeBackRun {
  id: number
  title: string
  day: string
  /** what taking it back removes; null = not known (the sheet drops the number) */
  points: number | null
}

/** Self-approved (by trust or bedtime), as opposed to a parent's OK. */
export const ownApproved = (via?: string | null) => via === 'trust' || via === 'bedtime'

/** "Monday" for a YYYY-MM-DD run day (within the last week), else "Oct 20". */
export function dayName(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const at = new Date(y, m - 1, d)
  const [ty, tm, td] = today.split('-').map(Number)
  const age = (new Date(ty, tm - 1, td).getTime() - at.getTime()) / 86_400_000
  return at.toLocaleDateString('en-US', age < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' })
}

/** POST /kid/chores/{id}/done: `done` = approved itself and paid; otherwise it waits (a spot check looks the same) */
export interface KidDoneResult {
  status: 'done' | 'submitted_for_approval'
}
