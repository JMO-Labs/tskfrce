import { useEffect, useRef, useState } from 'react'
import { PasswordInput } from '@mantine/core'
import { api, ApiError } from '@/v2/api'
import { PasswordEye } from '@/v2/components/PasswordEye'
import { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import { toastOk } from '../notify'
import { PaneCard } from './PaneParts'

/** Settings → Parents: change your own password. Anchor `#password` (the bell's "Change password"). */
export function PasswordCard() {
  const once = useSingleFlight()
  const ref = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (window.location.hash === '#password') ref.current?.scrollIntoView?.({ block: 'center' })
  }, [])

  const submit = async () => {
    if (next.length < 8) return setError('Use at least 8 characters for the password.')
    if (next !== again) return setError("Passwords don't match.")
    setError('')
    try {
      await api('/users/password', { method: 'POST', body: { current_password: cur, new_password: next } })
      setCur('')
      setNext('')
      setAgain('')
      toastOk('Password changed')
    } catch (e) {
      // 400 carries "That's not your current password."; plain call, not a mutation, so no session redirect
      setError(e instanceof ApiError ? e.detail : 'Something went wrong. Try again.')
    }
  }
  const eye = {
    visibilityToggleIcon: PasswordEye,
    'aria-describedby': error ? 'pw-err' : undefined,
    'aria-invalid': error ? true : undefined,
  }
  return (
    <div id="password" ref={ref}>
      <PaneCard icon="password" title="Your password">
        <form
          className="pn-form"
          onSubmit={(e) => {
            e.preventDefault()
            void once(submit)
          }}
        >
          <PasswordInput {...eye} label="Current password" value={cur} onChange={(e) => setCur(e.currentTarget.value)} autoComplete="current-password" />
          <PasswordInput {...eye} label="New password" value={next} onChange={(e) => setNext(e.currentTarget.value)} autoComplete="new-password" />
          <PasswordInput {...eye} label="Confirm new password" value={again} onChange={(e) => setAgain(e.currentTarget.value)} autoComplete="new-password" />
          {error && (
            <p id="pw-err" className="pn-help" role="alert">
              {error}
            </p>
          )}
          <div className="pn-row">
            <button type="submit" className="p-btn" data-variant="accent" disabled={!cur || !next || !again}>
              Change password
            </button>
          </div>
        </form>
      </PaneCard>
    </div>
  )
}
