import { useCallback, useRef } from 'react'
import { toastFail, toastOk } from '@/v2/notify'

/** Runs saves one at a time, in call order: a change made while another is saving waits, it is never dropped.
 *  Toasts `Saved` or the failure; resolves false when the save failed. */
export function useSaveQueue() {
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  return useCallback((fn: () => Promise<unknown>): Promise<boolean> => {
    const run = queue.current.then(fn).then(() => (toastOk('Saved'), true), (e) => (toastFail(e), false))
    queue.current = run
    return run
  }, [])
}
