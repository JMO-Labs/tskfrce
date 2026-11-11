/** Which "Try this" card shows: pure choice + the device-local one-new-card-a-day record. */

export const TRY_ORDER = ['try.celebrate', 'try.games', 'try.happyhour', 'try.autoboost', 'try.streakfreeze', 'try.trust', 'try.bedtime', 'try.goals', 'try.penalties'] as const
export const nudgeKey = (kidId: number) => `nudge.${kidId}`

const SHOWN = 'tskfrce.try'
const SNOOZE = 'tskfrce.try.snooze'
export const dayKey = () => new Date().toLocaleDateString('en-CA')

type Shown = { day: string; key: string }
const read = <T,>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null')
  } catch {
    return null
  }
}
export const writeShown = (key: string) => localStorage.setItem(SHOWN, JSON.stringify({ day: dayKey(), key }))
export const SNOOZE_EVENT = 'tskfrce.try.snooze'
export const snoozeNudge = (kidId: number) => {
  localStorage.setItem(SNOOZE, JSON.stringify({ ...read<object>(SNOOZE), [kidId]: dayKey() }))
  window.dispatchEvent(new Event(SNOOZE_EVENT)) // every Try-card picker re-reads
}
export const nudgeSnoozed = (kidId: number) => read<Record<number, string>>(SNOOZE)?.[kidId] === dayKey()

/**
 * `eligible` is in priority order. A card already shown today stays while it is still eligible;
 * once it is acted on nothing new appears until tomorrow.
 */
export function pickCard(eligible: string[]): string | null {
  const shown = read<Shown>(SHOWN)
  if (shown?.day === dayKey()) return eligible.includes(shown.key) ? shown.key : null
  return eligible[0] ?? null
}
