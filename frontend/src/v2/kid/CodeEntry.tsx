import { useState, type FormEvent } from 'react'
import { handoffError, redeemHandoff } from './handoff'

/** "I have a code": the typed hand-off from Safari into the home-screen app. */
export function CodeEntry({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open)
    return (
      <button type="button" className="r-btn" data-tone="plain" onClick={() => setOpen(true)}>
        I have a code
      </button>
    )
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !value.trim()) return
    setBusy(true)
    setError('')
    try {
      await redeemHandoff(value)
      onDone()
    } catch (err) {
      setError(handoffError(err))
      setBusy(false)
    }
  }
  return (
    <form className="k-code-form" onSubmit={submit}>
      <label htmlFor="k-code">Type your code</label>
      <input
        id="k-code"
        className="k-code-in"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        placeholder="XXXX-XXXX"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus
        aria-invalid={!!error}
        aria-describedby={error ? 'k-code-err' : undefined}
      />
      {error && (
        <p className="k-pin-err" id="k-code-err" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="r-btn" disabled={busy}>
        {busy ? 'Checking…' : 'Go'}
      </button>
    </form>
  )
}
