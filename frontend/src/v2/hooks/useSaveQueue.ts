import { useCallback, useRef } from 'react'
import { toastFail, toastOk } from '@/v2/notify'

/** Runs saves one at a time, in call order: a change made while another is saving waits, it is never dropped.
 *  Toasts `Saved` or the failure; resolves false when the save failed. A save that never reached the box
 *  (offline) keeps its value in the failure toast: Retry puts it back in the queue. */
export function useSaveQueue() {
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  return useCallback(function run(fn: () => Promise<unknown>): Promise<boolean> {
    const next = queue.current
      .then(fn)
      .then(() => (toastOk('Saved'), true), (e) => (toastFail(e, e instanceof TypeError ? () => void run(fn) : undefined), false))
    queue.current = next
    return next
  }, [])
}
