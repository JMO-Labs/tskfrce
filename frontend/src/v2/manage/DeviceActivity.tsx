import { useState } from 'react'
import { useDeviceActivity, useLockKid, useMarkOk, useMergeDevice } from '@/v2/hooks/useDeviceActivity'
import { openChat } from '@/v2/chat/dock'
import { ActionRow } from '@/v2/parent/ActionRow'
import type { ChipTone } from '@/v2/parent/Chip'
import { Icon } from '@/v2/parent/Icon'
import type { MenuItem } from '@/v2/parent/MoreMenu'
import { EmptyState, Skeleton } from '@/v2/parent/states'
import type { Device, DeviceActivity as Activity, DeviceEvent, EventKind, Kid } from '@/v2/types'
import { eventText, whenLabel } from './activityText'
import { nameOf } from './choreMeta'
import { LockHistory } from './LockHistory'
import { useNow } from '../today/useClock'
import { toastFail, toastOk } from '../notify'

// mirrors backend FILTERS (app/models/device_activity.py)
const FILTERS: { key: string; label: string; kinds?: EventKind[] }[] = [
  { key: 'all', label: 'All' },
  { key: 'bypass', label: 'Bypass', kinds: ['bypass', 'new_address', 'identity_change', 'workaround_try'] },
  { key: 'locked', label: 'While locked', kinds: ['locked_try', 'outside_hours', 'left_wifi'] },
  { key: 'sign_in', label: 'Sign-in', kinds: ['sign_in'] },
]

// [count, desktop label, phone label (mockup 04)]
const KPIS: [keyof Activity['counts'], string, string][] = [
  ['bypass', 'Bypass attempts · 7d', 'Bypass · 7d'],
  ['locked_tries', 'Tries while locked · 7d', 'Tries while locked'],
  ['outside_hours', 'Outside allowed hours · 7d', 'Outside hours'],
  ['wrong_pins', 'Wrong PINs · 7d', 'Wrong PINs'],
]

/** "2 h 10 min" / "1 h" / "45 min" */
export const duration = (m: number) => {
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`
}

type Act = MenuItem & { onClick: () => void }
const SEV_TONE: Record<string, ChipTone> = { hi: 'red', md: 'amb', lo: 'grey' }
const SEV_NAME: Record<string, string> = { hi: 'High priority', md: 'Medium priority', lo: 'Low priority' }

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })

interface Props {
  device: Device
  kids: Kid[]
  timeZone?: string
}

/** Activity row: 7-day KPIs, attempts and alerts with actions, time online per day, lock history. */
export function DeviceActivity({ device, kids, timeZone }: Props) {
  const { data, isLoading } = useDeviceActivity(device.id)
  const [filter, setFilter] = useState('all')
  const markOk = useMarkOk()
  const merge = useMergeDevice()
  const lockKid = useLockKid()
  const now = useNow()
  if (isLoading || !data) return <Skeleton rows={3} />

  const owner = kids.find((k) => k.id === device.owner_ids[0])
  const kidOf = (e: DeviceEvent) =>
    e.kind === 'sign_in' ? (e.kid_id ? { id: e.kid_id, name: e.kid_name ?? kids.find((k) => k.id === e.kid_id)?.username ?? 'kid' } : null)
    : owner ? { id: owner.id, name: nameOf(owner) } : null
  const kinds = FILTERS.find((f) => f.key === filter)?.kinds
  const events = kinds ? data.events.filter((e) => kinds.includes(e.kind)) : data.events
  const ev = (e: DeviceEvent) => ({ deviceId: device.id, eventId: e.id })

  // the first action is the row's main button, the rest go in its "…"
  const actions = (e: DeviceEvent): Act[] => {
    if (e.reviewed) return [] // already answered
    if (e.kind === 'new_address')
      return [
        { label: 'Same device, merge', icon: 'merge', disabled: merge.isPending, onClick: () => void merge.mutateAsync(ev(e)).then(() => toastOk('Merged'), toastFail) },
        { label: 'Different device', icon: 'devices', disabled: markOk.isPending, onClick: () => markOk.mutate(ev(e)) },
      ]
    const kid = kidOf(e)
    return [
      ...(kid ? [
        { label: `Ask ${kid.name}`, icon: 'chat', onClick: () => openChat('private', String(kid.id)) },
        {
          label: `Lock all ${kid.name}'s devices`, icon: 'lock', tone: 'red' as const, disabled: lockKid.isPending,
          onClick: () => lockKid.mutate({ kidId: kid.id, action: 'lock' }, { onSuccess: () => toastOk(`Locked all ${kid.name}'s devices`, { undo: () => lockKid.mutate({ kidId: kid.id, action: 'clear' }, { onSuccess: () => toastOk('Undone') }) }) }),
        },
      ] : []),
      { label: 'Mark OK', icon: 'check', disabled: markOk.isPending, onClick: () => markOk.mutate(ev(e)) },
    ]
  }

  const shown = [...data.days].reverse()
  const max = Math.max(1, ...shown.map((d) => d.online_minutes))

  return (
    <div className="pk-grid">
      <div className="da-kpis pk-span">
        {KPIS.map(([k, label, short]) => (
          <div key={k} className="da-kpi" data-hi={(k === 'bypass' && data.counts[k] > 0) || undefined}>
            <span className="da-long">{label}</span>
            <span className="da-short">{short}</span>
            <b>{data.counts[k] ?? 0}</b>
          </div>
        ))}
      </div>

      <section className="pk-panel pk-span" aria-label="Attempts & alerts">
        <h3 className="da-h3">
          <Icon name="policy" size={18} />
          Attempts &amp; alerts
          <span className="da-filt" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </span>
        </h3>
        {events.length === 0 ? (
          <EmptyState
            icon="verified_user"
            tone="acc"
            title="No attempts this week"
            body={`${device.name} hasn't tried to get around the lock or go online outside hours.`}
          />
        ) : (
          <ul className="da-list">
            {events.map((e) => {
              const t = eventText(e, device.name, timeZone)
              const [main, ...more] = actions(e)
              return (
                <li key={e.id} className="da-al" data-reviewed={e.reviewed || undefined}>
                  <ActionRow
                    icon={t.icon}
                    iconTone={SEV_TONE[t.sev]}
                    iconLabel={SEV_NAME[t.sev]}
                    title={t.title}
                    sub={`${whenLabel(e.at, timeZone, now)} · ${t.sub}`}
                    main={main && { label: main.label, onClick: main.onClick, disabled: main.disabled }}
                    menu={more.length ? more : undefined}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="pk-panel" aria-label="Time online per day">
        <h3>
          <Icon name="bar_chart" size={18} />
          Time online per day
        </h3>
        <div className="da-bars">
          {shown.map((d) => (
            <div key={d.date} className="da-bar-slot">
              <div className="da-bar" title={duration(d.online_minutes)} style={{ height: `max(2px, ${(d.online_minutes / max) * 100}%)` }} />
            </div>
          ))}
        </div>
        <div className="da-bl">
          {shown.map((d, i) => (
            <span key={d.date}>{i === shown.length - 1 ? 'Today' : weekday(d.date)}</span>
          ))}
        </div>
      </section>

      <LockHistory history={data.history} timeZone={timeZone} now={now} />
    </div>
  )
}
