import { useEffect, useRef } from 'react'
import { track } from './track'

/** Report setup progress: a step is "done" once a later step is reached. Going back sends nothing. */
export function useWizardTelemetry(step: number, last: number): void {
  const max = useRef(0)
  const finished = useRef(false)
  useEffect(() => {
    if (step <= max.current) return
    if (max.current > 0) track('wizard_step', { step: max.current, state: 'done' })
    max.current = step
    if (step <= last) track('wizard_step', { step, state: 'started' })
    else if (!finished.current) {
      finished.current = true
      track('wizard_done', {})
    }
  }, [step, last])
}
