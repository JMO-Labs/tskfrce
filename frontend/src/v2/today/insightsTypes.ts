/** GET /today/insights: Goals card and This week card. */
export interface InsightGoal {
  id: number
  name: string
  kid_id: number | null
  family: boolean
  saved: number
  target: number
  pct: number
  /** from the last 7 days' earn rate; null = no recent earning */
  eta_days: number | null
}

export interface InsightDay {
  day: string
  /** null = nothing was due that day */
  rate: number | null
  done: number
  total: number
}

export interface InsightWeek {
  rate: number | null
  /** points vs the previous 7 days; null = no previous week */
  delta: number | null
  goal: number
  series: InsightDay[]
  /** rows AM / PM / Evening, columns Mon..Sun */
  when: number[][]
  has_history: boolean
}

export interface Insights {
  goals: InsightGoal[]
  week: InsightWeek
}
