/** "Your alerts moved" flag: set when a refresh brings a new alert topic, cleared on tap. */
let moved = false
const subs = new Set<() => void>()
export const alertsMoved = (): boolean => moved
export const setAlertsMoved = (v: boolean): void => {
  moved = v
  subs.forEach((cb) => cb())
}
export const onAlertsMoved = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

