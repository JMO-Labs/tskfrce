import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useResetState } from '@/v2/hooks/useResetState'
import type { useSaveGroup } from '@/v2/hooks/useDevices'
import type { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import { GlyphPicker } from '@/v2/parent/GlyphPicker'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import type { Device, Group, HourRule, Kid } from '@/v2/types'
import { DEVICE_TYPE_ICON, getDeviceType } from './deviceMeta'
import { HoursTimeline } from './HoursTimeline'
import { intError, nameOf } from './choreMeta'
import { toasted } from '../notify'

/** the one save + single-flight guard GroupDetail hands to every row */
export interface Saver { save: ReturnType<typeof useSaveGroup>; once: ReturnType<typeof useSingleFlight> }

export const GROUP_ICONS = ['tablet_mac', 'sports_esports', 'tv', 'laptop', 'smartphone', 'speaker', 'router', 'devices_other', 'devices']

/** Devices row body: every device with an "In group" switch that saves on change. */
export function DevicesBody({ saver: { save, once }, group, devices, kids }: { saver: Saver; group: Group; devices: Device[]; kids: Kid[] }) {
  const toggle = (id: number) => {
    const next = group.device_ids.includes(id) ? group.device_ids.filter((i) => i !== id) : [...group.device_ids, id]
    once(() => toasted(save.mutateAsync({ id: group.id, name: group.name, device_ids: next }), 'Saved'))
  }
  if (!devices.length) return <p className="pk-hint">No devices yet.</p>
  return (
    <div className="gd-list">
      {[...devices].sort((a, b) => Number(group.device_ids.includes(b.id)) - Number(group.device_ids.includes(a.id))).map((d) => {
        const owner = d.status === 'guest' ? 'Guest' : kids.filter((k) => d.owner_ids.includes(k.id)).map(nameOf).join(', ') || 'No owner'
        const on = group.device_ids.includes(d.id)
        return (
          <div key={d.id} className="pk-switch gd-row">
            <span className="gd-ty"><Icon name={DEVICE_TYPE_ICON[getDeviceType(d.name, d.vendor)]} size={16} /></span>
            <span className="gd-t" id={`gd-${d.id}`}>{d.name}<small>{owner}</small></span>
            <button type="button" role="switch" aria-checked={on} aria-label={`${d.name} in group`} aria-describedby={`gd-${d.id}`} aria-disabled={save.isPending || undefined} onClick={() => !save.isPending && toggle(d.id)} />
          </div>
        )
      })}
    </div>
  )
}

interface SettingsProps {
  saver: Saver
  group: Group
  /** family screen-time setup: the price field exists only with group pricing on */
  pricing: { enabled?: boolean; group_pricing?: boolean; price?: number } | undefined
  /** bumps when Rename is picked: focus the name field */
  nameFocus?: number
}

/** Settings row body: name (saves on blur), icon in a pop-over, chore lock and price. */
export function SettingsBody({ saver: { save, once }, group, pricing, nameFocus = 0 }: SettingsProps) {
  const [name, setName] = useResetState(group.name)
  const [price, setPrice] = useResetState(group.screen_price != null ? String(group.screen_price) : '')
  const nameRef = useRef<HTMLInputElement>(null)
  const retryPrice = useRef(false) // a price blur landed while another save ran
  useEffect(() => { if (nameFocus) nameRef.current?.focus() }, [nameFocus])
  const priceErr = price.trim() === '' ? '' : intError(price, 1, 1000)
  // a free group (chore lock off) is never sold, so its price would do nothing
  const showPrice = !!pricing?.enabled && !!pricing.group_pricing && group.chore_lock
  const busy = save.isPending || undefined
  const base = { id: group.id, name: group.name, device_ids: group.device_ids }

  const rename = () => {
    const n = name.trim()
    if (!n) setName(group.name)
    else if (n !== group.name) once(() => toasted(save.mutateAsync({ ...base, name: n }), 'Renamed'))
  }
  const setExtra = (extra: { icon?: string; chore_lock?: boolean }) =>
    once(() => toasted(save.mutateAsync({ ...base, icon: group.icon, chore_lock: group.chore_lock, ...extra }), 'Saved'))
  const savePrice = () => {
    if (priceErr) return
    const next = price.trim() === '' ? null : Number(price)
    if (next === (group.screen_price ?? null)) return
    void once(() => toasted(save.mutateAsync({ ...base, screen_price: next }), 'Saved')).then((ran) => {
      if (!ran) retryPrice.current = true
    })
  }
  // retry a dropped price save once the other save is done and the group has refreshed
  useEffect(() => {
    if (!retryPrice.current || save.isPending) return
    retryPrice.current = false
    savePrice()
  }, [save.isPending, group]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gd-set">
      <label className="pk-field">
        <span className="pk-label">Group name</span>
        <input ref={nameRef} className="pk-input" aria-label="Group name" aria-busy={busy} maxLength={100} value={name} onChange={(e) => setName(e.currentTarget.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </label>
      <div className="gd-line">
        <span>Icon</span>
        <InfoPop label="Change icon" width={320} target={<button type="button" className="pk-tile gd-tile" aria-label="Change icon"><Icon name={group.icon} size={20} /></button>}>
          <GlyphPicker value={group.icon} onChange={(g) => g !== group.icon && setExtra({ icon: g })} choices={GROUP_ICONS} />
        </InfoPop>
      </div>
      <div className="gd-line">
        <span className="dv-lbl">
          <span id="group-chore-label">Lock with the kids&apos; chores</span>
          <InfoPop label="About chore lock"><p className="ch-pop-p">Off: these devices skip the chore check. Hours and manual locks still apply.</p></InfoPop>
        </span>
        <span className="pk-switch gd-sw">
          <button type="button" role="switch" aria-checked={group.chore_lock} aria-labelledby="group-chore-label" aria-disabled={busy} onClick={() => !save.isPending && setExtra({ chore_lock: !group.chore_lock })} />
        </span>
      </div>
      {showPrice && (
        <div className="gd-line">
          <span className="dv-lbl">
            <span>Screen time price</span>
            <InfoPop label="About group price"><p className="ch-pop-p">Points per 15 minutes on these devices. Leave empty to use the family price{pricing?.price != null ? ` (${pricing.price} pts)` : ''}.</p></InfoPop>
          </span>
          <span className="pk-input rw-unit rw-unit-wide">
            <input
              aria-label="Screen time price"
              inputMode="numeric"
              placeholder={pricing?.price == null ? 'Family price' : `Family price (${pricing.price})`}
              value={price}
              aria-invalid={!!priceErr}
              aria-describedby={priceErr ? 'group-price-err' : undefined}
              onChange={(e) => setPrice(e.currentTarget.value)}
              onBlur={savePrice}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <span aria-hidden="true">pts/15 min</span>
          </span>
        </div>
      )}
      {showPrice && priceErr && <span id="group-price-err" className="pk-error">{priceErr}</span>}
    </div>
  )
}

/** Hours row body: one timeline line per rule that covers this group, then the way to edit them. */
export function HoursBody({ group, rules, kids, groups }: { group: Group; rules: HourRule[]; kids: Kid[]; groups: Group[] }) {
  return (
    <div className="gd-set">
      <HoursTimeline rules={rules} kids={kids} groups={groups} thisGroup />
      <Link className="gd-link" href="/settings?section=hours">Edit in Settings › Hours ›</Link>
    </div>
  )
}

