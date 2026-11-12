/** Per-device state for the phone guide, kept in localStorage: seen once, and which steps are ticked. */
const SEEN = 'task4ce-phone-guide-seen'
const DONE = 'task4ce-phone-guide-done'

const read = <T,>(key: string, fallback: T): T => {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback } catch { return fallback }
}
const write = (key: string, v: unknown): void => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }

export const guideSeen = (id: number): boolean => read<number[]>(SEEN, []).includes(id)
export const markGuideSeen = (id: number): void => {
  const seen = read<number[]>(SEEN, [])
  if (!seen.includes(id)) write(SEEN, [...seen, id])
}
export const stepsDone = (id: number): string[] => read<Record<string, string[]>>(DONE, {})[id] ?? []
export const toggleStep = (id: number, step: string): void => {
  const all = read<Record<string, string[]>>(DONE, {})
  const cur = all[id] ?? []
  write(DONE, { ...all, [id]: cur.includes(step) ? cur.filter((s) => s !== step) : [...cur, step] })
}
