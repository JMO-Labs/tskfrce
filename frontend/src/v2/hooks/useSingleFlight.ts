import { useCallback, useRef } from 'react'

/** Runs `fn` unless a previous run is still going; resolves true if it ran. A ref, not isPending: a double-click or Enter-mash
 *  lands before React re-renders, so state-based guards let a second request through. */
export function useSingleFlight() {
  const busy = useRef(false)
  return useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (busy.current) return false
    busy.current = true
    try {
      await fn()
      return true
    } finally {
      busy.current = false
    }
  }, [])
}
