import { useState } from 'react'
import { Icon } from '@/v2/parent/Icon'
import { useWifiStatus, useWifiScan, useWifiJoin, useWifiForget, useWifiCountry, type WifiNetwork } from '@/v2/hooks/useWifi'
import { PaneCard, PaneHead } from './PaneParts'

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'FR', label: 'France' },
  { code: 'DE', label: 'Germany' },
]

const SECURITY_OPTIONS = [
  { value: 'wpa', label: 'WPA2/WPA3 Personal' },
  { value: 'sae', label: 'WPA3 Personal only' },
  { value: 'open', label: 'Open (no password)' },
]

interface JoinDialogState {
  open: boolean
  ssid: string
  password: string
  security: string
  hidden: boolean
  showPassword: boolean
}

export function WifiPane() {
  const status = useWifiStatus()
  const scan = useWifiScan()
  const join = useWifiJoin()
  const forget = useWifiForget()
  const country = useWifiCountry()

  const [listOpen, setListOpen] = useState(false)
  const [dialog, setDialog] = useState<JoinDialogState>({
    open: false,
    ssid: '',
    password: '',
    security: 'wpa',
    hidden: false,
    showPassword: false,
  })

  const handleScan = async () => {
    setListOpen(!listOpen)
    if (!listOpen && !scan.data) {
      scan.refetch()
    }
  }

  const selectNetwork = (ssid: string) => {
    setDialog({ ...dialog, open: true, ssid })
  }

  const handleJoin = () => {
    if (!dialog.ssid) return
    join.mutate({
      ssid: dialog.ssid,
      password: dialog.password || undefined,
      security: dialog.security,
      hidden: dialog.hidden || false,
    })
    setDialog({ open: false, ssid: '', password: '', security: 'wpa', hidden: false, showPassword: false })
  }

  const handleForget = () => {
    if (confirm('Forget current network?')) {
      status.data?.ssid && forget.mutate(status.data.ssid)
    }
  }

  const handleCountryChange = (code: string) => {
    country.mutate(code)
  }

  return (
    <div className="pn">
      <PaneHead title="Wi-Fi Settings" sub="Manage your box's Wi-Fi connection" />

      {/* Current Network */}
      <PaneCard icon="wifi" title="Current Network">
        {status.isPending && <div className="pn-help">Loading...</div>}
        {status.isError && <div className="pn-help" style={{ color: 'var(--p-err)' }}>Failed to load status</div>}
        {status.data && status.data.connected && (
          <div className="wifi-current">
            <div>
              <div className="wifi-name">{status.data.ssid}</div>
              <div className="pn-help">Connected — {status.data.signal}% signal</div>
            </div>
            <div className="wifi-badge">Connected</div>
          </div>
        )}
        {status.data && !status.data.connected && <div className="pn-help">Not connected</div>}
      </PaneCard>

      {/* Country/Region */}
      <PaneCard icon="public" title="Region">
        <div className="wifi-select-wrap">
          <select
            value={status.data?.country ?? ''}
            onChange={(e) => {
              if (e.target.value) handleCountryChange(e.target.value)
            }}
            className="wifi-select"
          >
            <option value="">Select a country...</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label} ({c.code})
              </option>
            ))}
          </select>
          <div className="pn-help">Affects available Wi-Fi channels and power limits.</div>
        </div>
      </PaneCard>

      {/* Scan and Join */}
      <PaneCard icon="wifi_off" title="Join Different Network">
        <button
          type="button"
          className="p-btn"
          onClick={handleScan}
          disabled={scan.isFetching}
          aria-busy={scan.isFetching}
        >
          <Icon name={listOpen ? 'expand_less' : 'wifi_find'} size={17} />
          {listOpen ? 'Hide' : 'Scan'} Networks
        </button>

        {listOpen && (
          <div className="wifi-list-wrap">
            {scan.isFetching && <div className="pn-help">Scanning...</div>}
            {scan.isError && <div className="pn-help" style={{ color: 'var(--p-err)' }}>Failed to scan</div>}
            {scan.data && (
              <div className="wifi-list">
                {scan.data.map((net: WifiNetwork) => (
                  <button
                    key={net.ssid}
                    type="button"
                    className="wifi-item"
                    onClick={() => selectNetwork(net.ssid)}
                  >
                    <div>
                      <div className="wifi-name">{net.ssid}</div>
                      <div className="pn-help">Signal: {net.signal}%</div>
                    </div>
                    <Icon name="wifi" size={18} />
                  </button>
                ))}
                <button type="button" className="wifi-item" onClick={() => setDialog({ ...dialog, open: true, ssid: '' })}>
                  <div>
                    <div className="wifi-name">Other network...</div>
                  </div>
                  <Icon name="add" size={18} />
                </button>
              </div>
            )}
          </div>
        )}
      </PaneCard>

      {/* Forget */}
      <PaneCard icon="delete" title="Manage">
        <button type="button" className="p-btn" onClick={handleForget}>
          <Icon name="delete" size={17} />
          Forget Current Network
        </button>
      </PaneCard>

      {/* Dialog */}
      {dialog.open && (
        <div className="wifi-modal-overlay" onClick={() => setDialog({ ...dialog, open: false })}>
          <div className="wifi-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wifi-modal-header">
              <h3>Join Network</h3>
              <button
                type="button"
                className="wifi-modal-close"
                onClick={() => setDialog({ ...dialog, open: false })}
                aria-label="Close"
              >
                <Icon name="x" size={24} />
              </button>
            </div>

            <div className="wifi-form-group">
              <label htmlFor="ssid">Network Name (SSID)</label>
              <input
                id="ssid"
                type="text"
                placeholder="Network name"
                value={dialog.ssid}
                onChange={(e) => setDialog({ ...dialog, ssid: e.target.value })}
                className="wifi-input"
              />
            </div>

            <div className="wifi-form-group">
              <label htmlFor="security">Security</label>
              <select
                id="security"
                value={dialog.security}
                onChange={(e) => setDialog({ ...dialog, security: e.target.value })}
                className="wifi-input"
              >
                {SECURITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {dialog.security !== 'open' && (
              <div className="wifi-form-group">
                <label htmlFor="password">Password</label>
                <div className="wifi-password-wrap">
                  <input
                    id="password"
                    type={dialog.showPassword ? 'text' : 'password'}
                    placeholder="8–63 characters"
                    value={dialog.password}
                    onChange={(e) => setDialog({ ...dialog, password: e.target.value })}
                    className="wifi-input"
                  />
                  <button
                    type="button"
                    className="wifi-toggle-pwd"
                    onClick={() => setDialog({ ...dialog, showPassword: !dialog.showPassword })}
                    aria-label="Toggle password visibility"
                  >
                    <Icon name={dialog.showPassword ? 'eye_off' : 'eye'} size={16} />
                  </button>
                </div>
                <div className="pn-help">8–63 characters</div>
              </div>
            )}

            <div className="wifi-form-group">
              <label className="wifi-checkbox">
                <input
                  type="checkbox"
                  checked={dialog.hidden}
                  onChange={(e) => setDialog({ ...dialog, hidden: e.target.checked })}
                />
                <span>Hidden network</span>
              </label>
            </div>

            <div className="wifi-modal-actions">
              <button
                type="button"
                className="p-btn"
                onClick={() => setDialog({ ...dialog, open: false })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="p-btn"
                data-variant="accent"
                onClick={handleJoin}
                disabled={!dialog.ssid || join.isPending}
                aria-busy={join.isPending}
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
