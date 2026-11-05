import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api, ApiError } from '@/v2/api'
import { useLook } from '@/v2/parent/useLook'
import { Icon } from '@/v2/parent/Icon'
import { AuthBrand } from '@/v2/components/AuthBrand'
import { clearClaim, groupClaim, readClaim } from './claim'

/** Box-code prompt before the wizard. A stored code (sticker QR) is checked without showing the form. */
export function ClaimGate({ onClaimed }: { onClaimed: (code: string) => void }) {
  useLook('parent')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [full, setFull] = useState(false) // 409: already set up
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(() => readClaim() !== null)
  const input = useRef<HTMLInputElement>(null)
  const started = useRef(false)

  const check = async (code: string, fromStore: boolean) => {
    setBusy(true)
    setError('')
    try {
      await api('/setup/claim', { method: 'POST', body: { code } })
      onClaimed(code)
    } catch (e) {
      const wrong = e instanceof ApiError && e.status === 403
      if (wrong) clearClaim() // 429 / network: keep the sticker code and prefill it for a retry
      else if (fromStore) setValue(groupClaim(code))
      setAuto(false)
      setBusy(false)
      if (e instanceof ApiError && e.status === 409) setFull(true)
      else setError(e instanceof Error ? e.message : "That code doesn't match. Check the sticker.")
    }
  }

  useEffect(() => {
    const stored = readClaim()
    if (!stored || started.current) return
    started.current = true
    void check(stored, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!auto) input.current?.focus()
  }, [auto])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const code = value.replace('-', '')
    if (busy || code.length < 10) return setError('Enter all 10 characters from the sticker.')
    void check(code, false)
  }

  return (
    <main className="p-auth-container">
      <AuthBrand />
      <div className="p-auth-form-side">
        {auto ? (
          <div className="p-auth-form" role="status" aria-live="polite">
            <h1>Checking your box…</h1>
            <Icon name="progress_activity" size={28} className="p-auth-spin" />
          </div>
        ) : (
          <form className="p-auth-form" onSubmit={submit} noValidate>
            <h1>Enter your box code</h1>
            <div className="p-subtitle">
              It&apos;s on the sticker on your box, under <b>Open my box</b>.
            </div>
            {full ? (
              <div className="p-auth-error" role="alert">
                <Icon name="error" />
                <span>
                  This box is already set up. <Link href="/login">Log in</Link>
                </span>
              </div>
            ) : (
              <>
                {error && (
                  <div className="p-auth-error" role="alert" id="claim-error">
                    <Icon name="error" />
                    {error}
                  </div>
                )}
                <div className="p-auth-form-field">
                  <label htmlFor="claim">Box code</label>
                  <div className="p-auth-input">
                    <Icon name="key" />
                    <input
                      id="claim"
                      ref={input}
                      value={value}
                      onChange={(e) => setValue(groupClaim(e.currentTarget.value))}
                      placeholder="K7M2Q-XA9PB"
                      autoCapitalize="characters"
                      autoComplete="one-time-code"
                      spellCheck={false}
                      inputMode="text"
                      aria-invalid={!!error}
                      aria-describedby={error ? 'claim-error' : undefined}
                      style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
                    />
                  </div>
                </div>
                <button type="submit" className="p-auth-button primary" disabled={busy} aria-busy={busy}>
                  {busy ? 'Checking…' : 'Continue'}
                  <Icon name={busy ? 'progress_activity' : 'arrow_forward'} size={20} className={busy ? 'p-auth-spin' : undefined} />
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </main>
  )
}
