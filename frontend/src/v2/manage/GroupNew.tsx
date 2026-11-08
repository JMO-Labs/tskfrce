import { useState } from 'react'
import { useSaveGroup } from '@/v2/hooks/useDevices'
import { useScreenTime } from '@/v2/hooks/useScreenTime'
import { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import { GlyphPicker } from '@/v2/parent/GlyphPicker'
import { HeaderChips } from '@/v2/parent/HeaderChips'
import { Icon } from '@/v2/parent/Icon'
import type { Device, Group, Kid } from '@/v2/types'
import { GROUP_ICONS } from './GroupRows'
import { intError, nameOf } from './choreMeta'
import { toastFail, toastOk } from '../notify'

/** The new-group form: a small form with Create / Cancel (an existing group saves as you go, see GroupDetail). */
export function GroupNew({ devices, kids, onSelect }: { devices: Device[]; kids: Kid[]; onSelect: (id: number | null) => void }) {
  const save = useSaveGroup()
  const once = useSingleFlight()
  const st = useScreenTime().data
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const priceErr = price.trim() === '' ? '' : intError(price, 1, 1000)
  const [ids, setIds] = useState<number[]>([])
  const [draft, setDraft] = useState<{ icon?: string; chore_lock?: boolean }>({})
  const icon = draft.icon ?? 'devices'
  const choreLock = draft.chore_lock ?? true
  const showPrice = !!st?.enabled && !!st?.group_pricing && choreLock
  const members = devices.filter((d) => ids.includes(d.id))
  const locked = members.filter((d) => !d.online && d.status !== 'guest' && !d.exempt).length
  const owners = kids.filter((k) => members.some((d) => d.owner_ids.includes(k.id))).map(nameOf).join(', ')
  const chips = [
    { text: `${members.length} ${members.length === 1 ? 'device' : 'devices'}`, icon: 'devices' },
    ...(members.length ? [{ text: `${members.length - locked} open`, icon: 'lock_open', tone: members.length > locked ? ('acc' as const) : ('plain' as const) }, { text: `${locked} locked`, icon: 'lock' }] : []),
    ...(owners ? [{ text: owners, icon: 'group' }] : []),
  ]
  const create = () =>
    once(() =>
      save.mutateAsync({ name: name.trim(), device_ids: ids, ...draft, ...(showPrice && price.trim() && !priceErr ? { screen_price: Number(price) } : {}) }).then((g) => {
        toastOk('Created')
        onSelect((g as Group).id)
      }, toastFail),
    )

  return (
    <div className="pk-detail">
      <header className="pk-head">
        <span className="pk-tile pk-tile-lg">
          <Icon name={icon} size={30} />
        </span>
        <div className="pk-head-t">
          <h2>{name.trim() || 'New group'}</h2>
          <HeaderChips items={chips} />
        </div>
      </header>

      <div className="pk-grid">
        <section className="pk-panel" aria-label="Devices in group">
          <h3>
            <Icon name="devices_other" size={18} />
            Devices in group
          </h3>
          {devices.length > 0 && ids.length === 0 && <p className="pk-hint">No devices in this group yet. Tap a device to add it.</p>}
          {devices.length === 0 ? (
            <p className="pk-hint">No devices yet.</p>
          ) : (
            <div className="pk-pills" role="group" aria-label="Devices in group">
              {devices.map((d) => (
                <button key={d.id} type="button" title={d.name} className="pk-pill pk-pill-plain" aria-pressed={ids.includes(d.id)} onClick={() => setIds(ids.includes(d.id) ? ids.filter((i) => i !== d.id) : [...ids, d.id])}>
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pk-panel" aria-label="Group">
          <h3>
            <Icon name="edit" size={18} />
            Group
          </h3>
          <label className="pk-field">
            <span className="pk-label">Group name</span>
            <input className="pk-input" aria-label="Group name" placeholder="Group name" maxLength={100} value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </label>
          <div className="pk-field">
            <span className="pk-label">Icon</span>
            <div className="pk-type-icons pk-group-icons">
              <GlyphPicker value={icon} onChange={(g) => g !== icon && setDraft({ ...draft, icon: g })} choices={GROUP_ICONS} />
            </div>
          </div>
          <div className="pk-switch ph-sw-row">
            <span id="group-chore-label">Lock with the kids&apos; chores</span>
            <button type="button" role="switch" aria-checked={choreLock} aria-labelledby="group-chore-label" onClick={() => setDraft({ ...draft, chore_lock: !choreLock })} />
          </div>
          <p className="pk-hint">Off: these devices skip the chore check. Hours and manual locks still apply.</p>
          {showPrice && (
            <>
              <label className="pk-field">
                <span className="pk-label">Screen time price</span>
                <span className="pk-input rw-unit rw-unit-wide">
                  <input aria-label="Screen time price" inputMode="numeric" placeholder={st?.price == null ? 'Family price' : `Family price (${st.price})`} value={price} aria-invalid={!!priceErr} onChange={(e) => setPrice(e.currentTarget.value)} />
                  <span aria-hidden="true">pts per 15 min</span>
                </span>
                {priceErr && <span className="pk-error">{priceErr}</span>}
              </label>
              <p className="pk-hint">Points per 15 minutes. Leave empty to use the family price.</p>
            </>
          )}
        </section>
      </div>

      <div className="pk-foot">
        <button type="button" className="p-btn" onClick={() => onSelect(null)}>
          Cancel
        </button>
        <button type="button" className="p-btn" data-variant="accent" onClick={create} disabled={!name.trim() || !!priceErr || save.isPending}>
          <Icon name={save.isPending ? 'progress_activity' : 'check'} className={save.isPending ? 'p-spin' : undefined} />
          {save.isPending ? 'Creating…' : 'Create group'}
        </button>
      </div>
    </div>
  )
}
