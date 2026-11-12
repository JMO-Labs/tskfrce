import { useState } from 'react'
import { Icon } from '@/v2/parent/Icon'
import { useBulkDevices, usePatchDevice, useRescanDevices } from '@/v2/hooks/useDevices'
import type { Device, Kid } from '@/v2/types'
import { ago } from './deviceMeta'

const kidName = (k: Kid) => k.full_name || k.username

/** "Who's this?" pane: every unknown device in one table, owner per row, bulk actions on a selection. */
export function UnknownDevices({ devices, kids }: { devices: Device[]; kids: Kid[] }) {
  const unknown = devices.filter((d) => d.status === 'unassigned')
  const ignored = devices.filter((d) => d.status === 'ignored')
  const [rawPicked, setPicked] = useState<number[]>([])
  const patch = usePatchDevice()
  const bulk = useBulkDevices()
  const rescan = useRescanDevices()
  const busy = bulk.isPending

  // a device that was just handled drops out of the selection (derived, no effect)
  const picked = rawPicked.filter((id) => unknown.some((d) => d.id === id))

  const allOn = unknown.length > 0 && picked.length === unknown.length
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  const run = (status: 'assigned' | 'guest' | 'ignored', owner_ids: number[] = []) => bulk.mutate({ ids: picked, status, owner_ids })
  const setOwner = (d: Device, v: string) => {
    if (v === 'guest') patch.mutate({ id: d.id, patch: { status: 'guest', owner_ids: [] } })
    else if (v) patch.mutate({ id: d.id, patch: { status: 'assigned', owner_ids: [Number(v)] } })
  }
  const maker = (d: Device) => d.vendor || d.maker_guess || null
  const detail = (d: Device) => [maker(d), d.ip, d.network].filter(Boolean).join(' · ')

  return (
    <div className="p-unk">
      <div className="p-unk-head">
        <span className="p-unk-big"><Icon name="help" size={24} /></span>
        <div>
          <h2>Who&apos;s this?{unknown.length > 0 && <span className="p-unk-n"> · {unknown.length}</span>}</h2>
          <p>Devices that joined your network and have no owner. Unknown devices follow &quot;New devices allowed&quot;.</p>
        </div>
        <button type="button" className="p-unk-btn" disabled={rescan.isPending} onClick={() => rescan.mutate(undefined)}>
          <Icon name="refresh" size={16} />Rescan
        </button>
      </div>

      {unknown.length === 0 ? (
        <p className="p-device-empty">Nobody new. Every device on your network has an owner.</p>
      ) : (
        <>
          {picked.length > 0 && (
            <div className="p-unk-bulk" role="toolbar" aria-label="Selected devices">
              <span className="p-unk-sel">{picked.length} selected</span>
              <select
                aria-label="Assign selected to"
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && run('assigned', [Number(e.target.value)])}
              >
                <option value="">Assign to…</option>
                {kids.map((k) => <option key={k.id} value={k.id}>{kidName(k)}</option>)}
              </select>
              <button type="button" className="p-unk-btn" disabled={busy} onClick={() => run('guest')}><Icon name="shield" size={16} />Mark guest</button>
              <button type="button" className="p-unk-btn" disabled={busy} onClick={() => run('ignored')}><Icon name="visibility_off" size={16} />Ignore</button>
              <span className="p-unk-sp" />
              <button type="button" className="p-unk-btn p-unk-ghost" onClick={() => setPicked([])}>Clear</button>
            </div>
          )}
          <div className="p-unk-card">
            <table className="p-unk-table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setPicked(allOn ? [] : unknown.map((d) => d.id))} /></th>
                  <th>Device</th><th className="p-unk-opt">Address</th><th className="p-unk-opt">Network</th><th className="p-unk-opt">First seen</th><th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {unknown.map((d) => (
                  <tr key={d.id} data-testid="unknown-row" className="p-unk-row" data-on={picked.includes(d.id) || undefined}>
                    <td className="p-unk-chk"><input type="checkbox" aria-label={`Select ${d.name}`} checked={picked.includes(d.id)} onChange={() => toggle(d.id)} /></td>
                    <td className="p-unk-nm">
                      <b title={d.name}>{d.name}{d.random_mac && <span className="p-unk-tag">private</span>}</b>
                      {maker(d) && <small className="p-unk-maker">{maker(d)}</small>}
                      <small className="p-unk-mob">{detail(d)}</small>
                    </td>
                    <td className="p-unk-opt p-unk-mono">{d.ip ?? '—'}</td>
                    <td className="p-unk-opt">{d.network ? <span className="p-unk-net">{d.network}</span> : '—'}</td>
                    <td className="p-unk-opt">{ago(d.first_seen)}</td>
                    <td className="p-unk-own">
                      <select aria-label={`Owner of ${d.name}`} value="" onChange={(e) => setOwner(d, e.target.value)}>
                        <option value="">Unknown</option>
                        {kids.map((k) => <option key={k.id} value={k.id}>{kidName(k)}</option>)}
                        <option value="guest">Guest</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ignored.length > 0 && (
        <details className="p-unk-ign">
          <summary><Icon name="visibility_off" size={16} />Ignored · {ignored.length} (never shown as unknown)</summary>
          <ul>
            {ignored.map((d) => (
              <li key={d.id}>
                {d.name}
                <button type="button" aria-label={`Undo ignore ${d.name}`} onClick={() => patch.mutate({ id: d.id, patch: { status: 'unassigned', owner_ids: [] } })}>
                  <Icon name="undo" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
