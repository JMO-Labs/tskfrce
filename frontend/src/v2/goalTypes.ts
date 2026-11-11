export type GoalKind = 'custom' | 'screen' | 'jail'
export type GoalStatus = 'suggested' | 'active' | 'full' | 'fulfilled'

export interface Goal {
  id: number
  name: string
  emoji: string | null
  kind: GoalKind
  family: boolean
  kid_id: number | null
  kid_name: string | null
  target: number | null
  saved: number
  minutes: number | null
  status: GoalStatus
  waiting_on: string | null
  /** what the viewing kid gave; 0 for parents */
  mine: number
  siblings: Array<{ name: string; amount: number }> | null
  created_at: string
  fulfilled_at: string | null
}

export interface GoalSettings {
  on: boolean
  suggest: boolean
  withdraw: boolean
  siblings: boolean
  auto: boolean
  auto_pct: number
  max_little: number
  max_kid: number
  max_teen: number
  screen_on: boolean
  screen_price: number
  screen_minutes: number
  jail_on: boolean
  jail_price: number
  /** read-only; true while screen time limits are on */
  screen_ok: boolean
}

export interface GoalBuiltin {
  kind: 'screen' | 'jail'
  name: string
  target: number
  minutes: number | null
}

export interface GoalParty {
  goal_id: number
  name: string
  by: string
}

export interface ParentGoals {
  settings: GoalSettings
  waiting: Goal[]
  family: Goal[]
  kids: Goal[]
  done: Goal[]
}

export interface KidGoals {
  on: boolean
  suggest: boolean
  withdraw: boolean
  auto: boolean
  auto_pct: number
  auto_goal_id: number | null
  can_add: boolean
  free: number
  builtins: GoalBuiltin[]
  goals: Goal[]
  done: Goal[]
  party: GoalParty[]
}

export interface CreateGoalBody {
  name: string
  emoji?: string | null
  target?: number
  kind?: GoalKind
  kid_ids: number[]
  family: boolean
}
