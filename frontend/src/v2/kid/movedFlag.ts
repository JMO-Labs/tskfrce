/** "Your alerts moved" flag: set when a refresh brings a new alert topic, cleared on tap. Kept in localStorage so it survives a reload. */
export const MOVED_KEY = 'task4ce-kid-alerts-moved'
const subs = new Set<() => void>()
export const alertsMoved = (): boolean => {
  try { return localStorage.getItem(MOVED_KEY) === '1' } catch { return false }
}
export const setAlertsMoved = (v: boolean): void => {
  try { v ? localStorage.setItem(MOVED_KEY, '1') : localStorage.removeItem(MOVED_KEY) } catch {}
  subs.forEach((cb) => cb())
}
export const onAlertsMoved = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}
