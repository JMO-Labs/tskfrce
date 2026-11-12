import { useState, type ChangeEvent, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconCheck, IconX } from '@tabler/icons-react'
import { api } from '../api'

export interface ParentForm { username: string; password: string; again: string; fullName: string }

export const parentErrors = (p: ParentForm) => ({
  fullName: p.fullName.trim() ? undefined : 'Enter your name.',
  username: /^[a-zA-Z0-9_.-]{3,50}$/.test(p.username)
    ? undefined
    : 'Use 3 or more letters, numbers, dots, dashes or underscores.',
  password: p.password.length >= 8 ? undefined : 'Use at least 8 characters.',
  again: p.again === p.password ? undefined : "The two passwords don't match.",
})

interface Props {
  value: ParentForm
  showError: boolean
  onChange: (v: ParentForm) => void
}

function ValidationRule({ met, text }: { met: boolean; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', margin: '4px 0', color: met ? '#4a9d1f' : '#5f5f5c' }}>
      {met ? <IconCheck size={16} /> : <IconX size={16} />}
      <span>{text}</span>
    </div>
  )
}

export function StepParent({ value, showError, onChange }: Props) {
  const err = parentErrors(value)
  const [nameSeen, setNameSeen] = useState(false)
  const [usernameSeen, setUsernameSeen] = useState(false)
  const [passwordSeen, setPasswordSeen] = useState(false)
  const [againSeen, setAgainSeen] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showAgain, setShowAgain] = useState(false)

  // Check username availability (uses anonymous endpoint before setup, auth after)
  const usernameQuery = useQuery({
    queryKey: ['username-available', value.username],
    queryFn: () =>
      api<{ available: boolean }>(`/setup/username-available?u=${encodeURIComponent(value.username)}`)
        .catch(() => api<{ available: boolean }>(`/setup/username-available-auth?u=${encodeURIComponent(value.username)}`)),
    enabled: !!value.username && !err.username,
    staleTime: Infinity,
  })
  const usernameAvailable = usernameQuery.data?.available ?? false
  const usernameFormatValid = !err.username

  const set = (k: keyof ParentForm) => (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.currentTarget.value })

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div style={{ background: 'var(--p-card)', border: '1px solid var(--p-line)', borderRadius: '18px', padding: '16px 18px' }}>
        <div style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--p-ink)' }}>Your Account</div>

        <div style={{ marginBottom: '12px' }}>
          <label htmlFor="fullName" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--p-ink)' }}>Your name</label>
          <input
            id="fullName"
            type="text"
            placeholder="e.g., Alex"
            value={value.fullName}
            onChange={set('fullName')}
            onBlur={() => setNameSeen(true)}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--p-line)',
              borderRadius: '8px',
              fontSize: '14px',
              backgroundColor: 'var(--p-card)',
              color: 'var(--p-ink)',
              fontFamily: 'inherit',
            }}
          />
          {(showError || nameSeen) && err.fullName && (
            <div style={{ fontSize: '12px', color: '#ff9b8f', marginTop: '4px' }}>{err.fullName}</div>
          )}
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label htmlFor="username" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--p-ink)' }}>Username</label>
          <input
            id="username"
            type="text"
            placeholder="e.g., alex_smith"
            value={value.username}
            onChange={set('username')}
            onBlur={() => setUsernameSeen(true)}
            autoComplete="username"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: (showError || usernameSeen) && (err.username || !usernameAvailable) ? '1px solid #ff9b8f' : '1px solid var(--p-line)',
              borderRadius: '8px',
              fontSize: '14px',
              backgroundColor: 'var(--p-card)',
              color: 'var(--p-ink)',
              fontFamily: 'inherit',
            }}
          />
          {value.username && (
            <>
              <ValidationRule met={usernameFormatValid} text="3+ letters, numbers, dots, dashes or underscores" />
              {usernameFormatValid && usernameQuery.isPending && (
                <div style={{ fontSize: '12px', color: 'var(--p-sub)', marginTop: '4px' }}>Checking...</div>
              )}
              {usernameFormatValid && usernameQuery.isSuccess && (
                <ValidationRule met={usernameAvailable} text={usernameAvailable ? 'Available' : 'Taken, try another'} />
              )}
            </>
          )}
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label htmlFor="password" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--p-ink)' }}>Password</label>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="8+ characters"
            value={value.password}
            onChange={set('password')}
            onBlur={() => setPasswordSeen(true)}
            autoComplete="new-password"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: (showError || passwordSeen) && err.password ? '1px solid #ff9b8f' : '1px solid var(--p-line)',
              borderRadius: '8px',
              fontSize: '14px',
              backgroundColor: 'var(--p-card)',
              color: 'var(--p-ink)',
              fontFamily: 'inherit',
            }}
          />
          {value.password && <ValidationRule met={!err.password} text="8+ characters" />}
        </div>

        <div style={{ marginBottom: '0' }}>
          <label htmlFor="passwordConfirm" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--p-ink)' }}>Type it again</label>
          <input
            id="passwordConfirm"
            type={showAgain ? 'text' : 'password'}
            placeholder="Confirm password"
            value={value.again}
            onChange={set('again')}
            onBlur={() => setAgainSeen(true)}
            autoComplete="new-password"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: (showError || againSeen) && err.again ? '1px solid #ff9b8f' : '1px solid var(--p-line)',
              borderRadius: '8px',
              fontSize: '14px',
              backgroundColor: 'var(--p-card)',
              color: 'var(--p-ink)',
              fontFamily: 'inherit',
            }}
          />
          {value.again && <ValidationRule met={!err.again} text="Passwords match" />}
          {(showError || againSeen) && err.again && (
            <div role="alert" style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>{err.again}</div>
          )}
        </div>
      </div>
    </div>
  )
}
