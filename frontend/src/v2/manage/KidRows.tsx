import type { ReactNode } from 'react'
import Link from 'next/link'
import { useDevices } from '@/v2/hooks/useDevices'
import { useLibrary } from '@/v2/hooks/useChores'
import { useChoreTypes } from '@/v2/hooks/useChoreTypes'
import { useToday } from '@/v2/hooks/useToday'
import { useSelfApproved } from '@/v2/hooks/useTrust'
import { Chip } from '@/v2/parent/Chip'
import { Icon } from '@/v2/parent/Icon'
import { SummaryRow } from '@/v2/parent/SummaryRow'
import { LoadFail } from '@/v2/parent/states'
import type { Focus } from '@/v2/parent/useFocusParam'
import { threadGlyph } from '@/v2/today/choreIcon'
import type { Kid } from '@/v2/types'
import { AGE_LABEL } from './ageGroups'
import { KidCelebrations } from './KidCelebrations'
import { KidProfileForm } from './KidEditor'
import { KidPhoneRows } from './KidPhoneRows'
import { TrustBody, TrustLine } from './TrustSection'
import { DEVICE_TYPE_ICON, getDeviceType } from './deviceMeta'
import { nameOf, schedules } from './choreMeta'

interface RowProps { kid: Kid; focus: Focus }
const ico = (name: string) => <Icon name={name} size={18} />
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const CELEBRATE = { full: 'Full', small: 'Small', off: 'Off' } as const

export function TrustRow({ kid, focus }: RowProps) {
  const q = useSelfApproved(kid.id)
  const n = q.data?.length
  const loading = !!kid.trust_mode && q.isPending
  const summary = !kid.trust_mode ? 'Off' : q.isError ? "Couldn't load" : n === undefined ? '' : n === 0 ? 'None approved yet' : `${n} approved on their own`
  return (
    <SummaryRow id="trust" icon={ico('verified_user')} title="Trust" summary={summary} loading={loading} line2={<TrustLine kid={kid} />} focus={focus}>
      {kid.trust_mode && q.isError && <LoadFail error={q.error} onRetry={() => void q.refetch()} />}
      <TrustBody kid={kid} />
    </SummaryRow>
  )
}

export function DevicesRow({ kid, focus }: RowProps) {
  const q = useDevices()
  const devices = (q.data ?? []).filter((d) => d.owner_ids.includes(kid.id))
  const locked = devices.filter((d) => !d.exempt && !d.online).length
  const summary = q.isError ? "Couldn't load" : devices.length === 0 ? 'No devices yet' : locked === 0 ? `${plural(devices.length, 'device')} · all open` : `${devices.length - locked} open · ${locked} locked`
  return (
    <SummaryRow id="devices" icon={ico('devices')} title="Devices" summary={summary} loading={q.isPending} focus={focus}>
      {q.isError && <LoadFail error={q.error} onRetry={() => void q.refetch()} />}
      {q.isSuccess && devices.length === 0 && <p className="pk-hint">Give a device an owner from Devices.</p>}
      <div className="kd-list">
        {devices.map((d) => (
          <div key={d.id} className="kd-prow">
            <span className="kd-ty">
              <Icon name={DEVICE_TYPE_ICON[getDeviceType(d.name, d.vendor)]} size={16} />
            </span>
            <span className="pk-card-t">
              <b>{d.name}</b>
            </span>
            {d.exempt ? <Chip tone="lav" icon="verified_user">Exempt</Chip> : d.online ? <Chip tone="acc" icon="lock_open">Open</Chip> : <Chip tone="grey" icon="lock">Locked</Chip>}
          </div>
        ))}
        <KidPhoneRows kid={kid} />
      </div>
    </SummaryRow>
  )
}

export function ChoresRow({ kid, focus }: RowProps) {
  const lib = useLibrary()
  const chores = (lib.data ?? []).filter((c) => c.assignments.some((a) => a.active && a.kid_ids.includes(kid.id)))
  const types = useChoreTypes().data
  const glyphs = new Map((Array.isArray(types) ? types : []).map((ty) => [ty.id, ty.glyph]))
  const mine = chores.flatMap((c) => c.assignments.filter((a) => a.active && a.kid_ids.includes(kid.id)))
  const summary = lib.isError ? "Couldn't load" : chores.length === 0 ? 'No chores yet' : mine.every((a) => a.repeat.type === 'daily') ? `${chores.length} daily` : plural(chores.length, 'chore')
  return (
    <SummaryRow id="chores" icon={ico('checklist')} title="Chores" summary={summary} loading={lib.isPending} focus={focus}>
      {lib.isError && <LoadFail error={lib.error} onRetry={() => void lib.refetch()} />}
      {lib.isSuccess && chores.length === 0 && <p className="pk-hint">No chores assigned yet. Add one from Chores.</p>}
      {chores.length > 0 && (
        <div className="kd-list">
          {chores.map((c) => {
            const sub = schedules(c, kid.id).join(' · ')
            return (
              <Link key={c.id} href={`/kids?section=chores&item=${c.id}`} className="kd-prow kd-link">
                <span className="kd-ty">
                  <Icon name={threadGlyph(glyphs.get(c.type_id), c.title)} size={16} />
                </span>
                <span className="pk-card-t">
                  <b>{c.title}</b>
                  <small>{sub.charAt(0).toUpperCase() + sub.slice(1)}</small>
                </span>
              </Link>
            )
          })}
        </div>
      )}
      <Link href="/kids?section=chores" className="pt-klink">
        Edit in Chores ›
      </Link>
    </SummaryRow>
  )
}

const kv = (label: string, value: ReactNode) => (
  <div className="kd-kv">
    <span>{label}</span>
    <b>{value}</b>
  </div>
)

export function SettingsRow({ kid, focus, editing, focusPin, onSaved, onCancel, onDirty }: RowProps & {
  editing: boolean; focusPin: boolean; onSaved: () => void; onCancel: () => void; onDirty: (d: boolean) => void
}) {
  const next = useToday().data?.kids.find((k) => k.id === kid.id)?.next_reward
  const nextRow = next != null ? kv('Next reward', `${next} pts away`) : null
  return (
    <SummaryRow id="settings" icon={ico('tune')} title="Settings" summary={`Celebrations: ${CELEBRATE[kid.celebrate as keyof typeof CELEBRATE] ?? 'Mode default'}`} focus={focus}>
      <div>
        <div className="p-sec-h">Profile</div>
        {editing ? (
          <KidProfileForm kid={kid} focusPin={focusPin} onSaved={onSaved} onCancel={onCancel} onDirty={onDirty} tail={nextRow} />
        ) : (
          <div className="kd-list kd-kvs">
            {kv('Name', nameOf(kid))}
            {kv('Age group', AGE_LABEL[kid.age_group])}
            {kv('PIN', kid.has_pin ? '•••• set' : 'Not set')}
            {nextRow}
          </div>
        )}
      </div>
      <KidCelebrations kid={kid} />
    </SummaryRow>
  )
}
