import type { KidPlan, Style } from './types'

export const STYLE_LABEL: Record<Style, string> = { relaxed: 'Relaxed', balanced: 'Balanced', strict: 'Strict' }

export function minutes(m: number): string {
  const h = Math.floor(m / 60)
  const r = m % 60
  return [h ? `${h}h` : '', r ? `${r}m` : ''].filter(Boolean).join(' ') || '0m'
}

/** "20:30" -> "8:30" */
export function clock(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`
}

export const ROWS: Array<{ label: string; value: (p: KidPlan) => string }> = [
  { label: 'Chores a day', value: (p) => String(p.chores.length) },
  { label: 'Screen time', value: (p) => minutes(p.screen) },
  { label: 'Bedtime', value: (p) => clock(p.bedtime) },
  { label: 'Internet locks till chores done', value: (p) => (p.lock ? 'yes' : 'no') },
  { label: 'You check every chore', value: (p) => (p.trust ? 'trust mode' : p.photo ? 'yes + photo' : 'yes') },
]

const KEYS: Record<string, string> = {
  chores: 'Chores a day',
  screen: 'Screen time',
  bedtime: 'Bedtime',
  lock: 'Internet locks till chores done',
  trust: 'Trust mode',
  photo: 'Photo proof',
  banked: 'Banked time',
}

export const keyLabel = (key: string): string => KEYS[key] ?? key

export function fmtValue(key: string, value: unknown): string {
  if (key === 'chores') return String(Array.isArray(value) ? value.length : value)
  if (key === 'screen') return minutes(Number(value))
  if (key === 'bedtime') return clock(String(value))
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  return String(value)
}
