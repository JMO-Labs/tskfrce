import type { NeedsItem } from '../types'

/** The card timeline runs 7am to 9pm, in minutes since midnight. */
export const DAY_START = 7 * 60
export const DAY_END = 21 * 60

/** Position on the timeline, 0-100 (clamped). */
export const pct = (min: number) => Math.min(100, Math.max(0, ((min - DAY_START) / (DAY_END - DAY_START)) * 100))

/** 930 → "3:30 PM". */
export function hm(min: number): string {
  const h = Math.floor(min / 60) % 24
  return `${h % 12 || 12}:${String(Math.round(min % 60)).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Minutes since local midnight of `at` in time zone `tz`. */
export function minuteOfDay(at: Date | string, tz?: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).formatToParts(new Date(at))
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return n('hour') * 60 + n('minute')
}

/** Fraction 0-1 of `num` in `den`; 0 when nothing is due. */
export const frac = (num: number, den: number) => (den > 0 ? Math.min(1, Math.max(0, num / den)) : 0)

const CHORES = new Set(['chore', 'redo'])
const REWARDS = new Set(['reward', 'screen_time'])

export interface Waiting { total: number; chores: number; rewards: number; oldestMin: number | null }

/** Counts for the waiting banner; `oldestMin` is the age of the oldest timed item. */
export function waitingStats(items: NeedsItem[], now: number): Waiting {
  const times = items.flatMap((i) => (i.submitted_at ? [Date.parse(i.submitted_at)] : [])).filter((t) => !Number.isNaN(t))
  return {
    total: items.length,
    chores: items.filter((i) => CHORES.has(i.type)).length,
    rewards: items.filter((i) => REWARDS.has(i.type)).length,
    oldestMin: times.length ? Math.max(0, Math.floor((now - Math.min(...times)) / 60000)) : null,
  }
}

/** 42 → "42m", 135 → "2h 15m". */
export const ageText = (min: number) => (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`)

/** Header stamp: "Wednesday · 4:12 PM" (phones: "4:12 PM"), in the family's time zone. */
export function headerStamp(now: number, tz: string | undefined, phone: boolean): string {
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(now)
  if (phone) return time
  return `${new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(now)} · ${time}`
}

/** Amber after this many minutes. */
export const STALE_MIN = 30
