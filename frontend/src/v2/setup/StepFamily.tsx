import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Select, TextInput } from '@mantine/core'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '../api'
import { errorText } from '../errorText'
import { useClientValue } from '../hooks/useClientValue'

export const detectTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

let zonesCache: string[] | undefined
const allZones = (): string[] => {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  return (zonesCache ??= Array.from(new Set([detectTz(), ...all])))
}

interface Props {
  name: string
  tz: string
  showError: boolean
  onName: (v: string) => void
  onTz: (v: string) => void
}

export function StepFamily({ name, tz, showError, onName, onTz }: Props) {
  // empty on the server so hydration matches; filled after mount
  const zones = useClientValue(allZones, [tz])
  const [showInvite, setShowInvite] = useState(false)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState('')

  const invite = useMutation({
    mutationFn: () => api<{ token: string }>('/users/invite-parent', { method: 'POST', body: {} }),
    onSuccess: (data) => {
      setInviteToken(data.token)
    },
  })

  const inviteUrl = inviteToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/setup?invite=${inviteToken}` : ''

  const copyToClipboard = () => {
    navigator.clipboard.writeText(inviteUrl)
    setCopyMessage('Copied!')
    setTimeout(() => setCopyMessage(''), 2000)
  }

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div style={{ background: 'var(--p-card)', border: '1px solid var(--p-line)', borderRadius: '18px', padding: '16px 18px' }}>
        <div style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--p-ink)' }}>Family</div>
        <div style={{ marginBottom: '12px' }}>
          <label htmlFor="familyName" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--p-ink)' }}>Family name</label>
          <input
            id="familyName"
            type="text"
            placeholder="The Smiths"
            value={name}
            onChange={(e) => onName(e.currentTarget.value)}
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
          <p style={{ fontSize: '12px', color: 'var(--p-sub)', marginTop: '4px', marginBottom: '0' }}>Time zone auto-detected.</p>
          {showError && !name.trim() && <p style={{ fontSize: '12px', color: '#ff9b8f', marginTop: '4px', marginBottom: '0' }}>Enter a family name.</p>}
        </div>
      </div>

      {!inviteToken && (
        <div style={{ background: 'var(--p-card)', border: '1px solid var(--p-line)', borderRadius: '18px', padding: '16px 18px' }}>
          <div style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--p-ink)' }}>Add another parent</div>
          <p style={{ fontSize: '12.5px', color: 'var(--p-sub)', margin: '0 0 12px' }}>Share a one-time invite with another parent. They choose their own username and password.</p>
          <button
            onClick={() => invite.mutate()}
            disabled={invite.isPending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px 14px',
              border: '1px solid var(--p-line)',
              borderRadius: '999px',
              background: 'var(--p-acc)',
              borderColor: 'var(--p-acc)',
              color: '#292928',
              font: '600 13px inherit',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              opacity: invite.isPending ? 0.5 : 1,
            }}
          >
            {invite.isPending ? 'Creating...' : 'Create invite'}
          </button>
          {invite.error && <p style={{ fontSize: '12px', color: '#ff9b8f', marginTop: '8px' }}>Error: {errorText(invite.error)}</p>}
        </div>
      )}

      {inviteToken && (
        <div style={{ background: 'var(--p-card)', border: '1px solid var(--p-line)', borderRadius: '18px', padding: '16px 18px' }}>
          <div style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--p-ink)' }}>One-time invite</div>
          <div style={{ width: '120px', height: '120px', background: 'var(--p-soft)', borderRadius: '8px', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px' }}>
            <QRCodeSVG value={inviteUrl} size={104} level="M" marginSize={0} />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--p-sub)', marginBottom: '8px' }}>Or share this link:</p>
          <div style={{ padding: '10px', background: 'var(--p-soft)', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <span style={{ flex: 1, minWidth: 0 }}>{inviteUrl}</span>
            <button
              onClick={copyToClipboard}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                border: '1px solid var(--p-line)',
                borderRadius: '4px',
                background: 'var(--p-card)',
                color: 'var(--p-ink)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {copyMessage || 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
