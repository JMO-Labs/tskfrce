import { useCallback, useEffect, useRef } from 'react'
import { track } from './track'

type Form = 'chore' | 'kid' | 'window' | 'feedback'

/** Sends form_abandoned when a dirty form is closed or reset without saving. Call the returned `saved()` on success. */
export function useFormAbandon(form: Form, dirty: boolean): () => void {
  const was = useRef(false)
  const saved = useRef(false)
  const live = useRef(dirty)

  useEffect(() => {
    live.current = dirty
    if (dirty && !was.current) saved.current = false
    if (!dirty && was.current && !saved.current) track('form_abandoned', { form })
    was.current = dirty
  }, [dirty, form])

  useEffect(
    () => () => {
      if (live.current && !saved.current) track('form_abandoned', { form })
    },
    [form],
  )

  return useCallback(() => {
    saved.current = true
  }, [])
}
