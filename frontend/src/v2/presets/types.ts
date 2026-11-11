import type { AgeGroup } from '@/v2/types'

export type Style = 'relaxed' | 'balanced' | 'strict'

export interface KidPlan {
  chores: string[]
  screen: number
  bedtime: string
  weekend: string
  lock: boolean
  trust: boolean
  photo: boolean
}

export interface FamilyPlan {
  banked: boolean
  goals?: boolean
  penalties?: boolean
}

export interface PresetKid {
  id: number
  name: string
  age_group: AgeGroup
  style: Style | null
}

export interface PresetCatalog {
  style: Style | null
  kids: PresetKid[]
  plans: Record<AgeGroup, Record<Style, KidPlan>>
  family: Record<Style, FamilyPlan>
}

export interface PresetBody {
  style?: Style
  /** kid id -> style; null follows the family */
  kids?: Record<string, Style | null>
  skip?: string[]
}

export interface PresetChange {
  kid_id: number | null
  who: string | null
  key: string
  now: unknown
  next: unknown
}

export interface PresetResult {
  style: Style
  kids: PresetKid[]
  changes: PresetChange[]
  kept: PresetChange[]
}
