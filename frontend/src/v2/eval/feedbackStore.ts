import { useSyncExternalStore } from 'react'

let open = false
const subs = new Set<() => void>()

function set(v: boolean): void {
  if (open === v) return
  open = v
  subs.forEach((s) => s())
}

export const openFeedback = (): void => set(true)
export const closeFeedback = (): void => set(false)

export function useFeedbackOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => open,
    () => false,
  )
}
