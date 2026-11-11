import dayjs from 'dayjs'

export type PenaltyKind = 'points' | 'screen' | 'block'
export type EarnBack = 'none' | 'half' | 'all'
export type SizeKey = 'small' | 'medium' | 'big'

export interface PenaltySize {
  kind: PenaltyKind
  amount: number
  earn_back: EarnBack
}

/** Task 4 `penalties.out` */
export interface Penalty {
  id: number
  kid_id: number
  group_id: string | null
  kind: PenaltyKind
  amount: number
  amount_taken: number
  amount_returned: number
  back_total: number
  label: string | null
  earn_back: EarnBack
  reason: string | null
  given_by: string | null
  created_at: string
  ends_at: string | null
  status: 'active' | 'ended' | 'cancelled' | 'forgiven'
  seen_by_kid: boolean
  summary: string
  /** what it was for: a chore title or "Security alert" */
  cause: string | null
  makeup: { run_id: number; title: string; status: string }[]
}

export interface KidPenalty extends Penalty {
  by_name: string
}

/** Penalty fields on shared payloads (merged into types.ts interfaces) */
export interface DevicePenaltyFields {
  /** active block penalty on this device (only when it is why the device is offline) */
  penalty?: { id: number; ends_at: string } | null
}

export interface FamilyPenaltyFields {
  penalties_enabled: boolean
  penalty_sizes: Record<SizeKey, PenaltySize>
  makeup_chores: string[]
}

export interface KidTodayPenaltyFields {
  penalties?: KidPenalty[]
}

/** GET /penalties/options */
export interface PenaltyOptions {
  enabled: boolean
  sizes: Record<SizeKey, PenaltySize>
  makeup_chores: string[]
  kids: {
    id: number
    name: string
    recent: number
    devices: { id: number; name: string }[]
    groups: { id: number; name: string }[]
  }[]
}

export interface PenaltyDraft {
  kind: PenaltyKind
  amount: number
  earn_back: EarnBack
  reason: string
  device_id?: number | null
  group_id?: number | null
  makeup?: string[]
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function duration(min: number): string {
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const parts = [d && plural(d, 'day'), h && plural(h, 'hour'), m && `${m} min`].filter(Boolean)
  return parts.join(' ') || '0 min'
}

export function whatLine(d: PenaltyDraft, label: string): string {
  if (d.kind === 'points') return `−${d.amount} points`
  if (d.kind === 'screen') return `−${d.amount} min saved screen time`
  return `No ${label || 'devices'}, ${duration(d.amount)}`
}

export const earnLine = (e: EarnBack): string =>
  e === 'half' ? 'Earn back half' : e === 'all' ? 'Earn back all' : 'No earn-back'

export const presetFor = (recent: number): SizeKey => (recent <= 0 ? 'small' : recent === 1 ? 'medium' : 'big')

export function repeatHint(recent: number): string | null {
  if (recent <= 0) return null
  if (recent === 1) return '2nd this week'
  if (recent === 2) return '3rd this week'
  return `${recent + 1}th this week`
}

export function stepAmount(kind: PenaltyKind, amount: number, dir: 1 | -1): number {
  if (kind === 'points') return Math.min(1000, Math.max(5, amount + 5 * dir))
  if (kind === 'screen') return Math.min(600, Math.max(15, amount + 15 * dir))
  const step = amount < 1440 || (amount === 1440 && dir === -1) ? 60 : 1440
  return Math.min(20160, Math.max(60, amount + step * dir))
}

export function kidTitle(p: KidPenalty, now: Date): string {
  if (p.kind === 'points') return `${p.amount_taken} points taken`
  if (p.kind === 'screen') return `${p.amount_taken} min of saved screen time taken`
  if (!p.ends_at) return `No ${p.label ?? 'devices'}`
  const end = dayjs(p.ends_at)
  const sameDay = end.isSame(dayjs(now), 'day')
  return `No ${p.label ?? 'devices'} until ${end.format(sameDay ? 'h:mm a' : 'dddd')}`
}
