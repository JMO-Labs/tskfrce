import { useRouter } from 'next/router'
import { useResetState } from '@/v2/hooks/useResetState'
import { usePatchDevice, useSaveGroup, type DevicePatch } from '@/v2/hooks/useDevices'
import { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import { InfoPop } from '@/v2/parent/InfoPop'
import { KidPicker } from '@/v2/parent/KidPicker'
import type { Device, Group, Kid } from '@/v2/types'
import { nameOf } from './choreMeta'
import { OnlineWeek, useDailyHours, WeekBars } from './OnlineWeek'
import { toasted } from '../notify'

interface Props { device: Device; kids: Kid[]; groups: Group[] }

/** Details row body: name, owners, groups, Guest and Always allowed. Every change saves at once. */
export function DetailsBody({ device, kids, groups }: Props) {
  const router = useRouter()
  const patch = usePatchDevice()
  const saveGroup = useSaveGroup()
  const once = useSingleFlight()
  const [name, setName] = useResetState(device.name)
  const guest = device.status === 'guest'
  const owners = kids.filter((k) => device.owner_ids.includes(k.id))
  const save = (p: DevicePatch) => once(() => toasted(patch.mutateAsync({ id: device.id, patch: p }), 'Saved'))
  const rename = () => {
    const n = name.trim()
    if (!n) setName(device.name)
    else if (n !== device.name) once(() => toasted(patch.mutateAsync({ id: device.id, patch: { name: n } }), 'Renamed'))
  }
  const toggleGroup = (g: Group) => {
    const ids = g.device_ids.includes(device.id) ? g.device_ids.filter((i) => i !== device.id) : [...g.device_ids, device.id]
    once(() => toasted(saveGroup.mutateAsync({ id: g.id, name: g.name, device_ids: ids }), 'Saved'))
  }
  return (
    <>
      <label className="pk-field">
        <span className="pk-label">Name</span>
        <input
          className="pk-input"
          aria-label="Device name"
          maxLength={100}
          aria-busy={patch.isPending || undefined}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      <div className="pk-field">
        <span className="pk-label">Owners</span>
        <KidPicker kids={kids} label="Owners" value={device.owner_ids.map(String)} disabled={guest} busy={patch.isPending} onChange={(v) => save({ owner_ids: v.map(Number) })} />
      </div>
      {groups.length > 0 && (
        <div className="pk-field">
          <span className="pk-label">Groups</span>
          <div className="pk-pills" role="group" aria-label="Groups">
            {groups.map((g) => (
              <button key={g.id} type="button" title={g.name} className="pk-pill pk-pill-plain" aria-pressed={g.device_ids.includes(device.id)} aria-disabled={saveGroup.isPending || undefined} onClick={() => !saveGroup.isPending && toggleGroup(g)}>
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="pk-switch">
        <span id="guest-label">Guest (never blocked)</span>
        <button type="button" role="switch" aria-checked={guest} aria-labelledby="guest-label" aria-disabled={patch.isPending || undefined}
          onClick={() => !patch.isPending && save({ status: !guest ? 'guest' : device.owner_ids.length ? 'assigned' : 'unassigned' })} />
      </div>
      {!guest && (
        <div className="pk-switch ph-sw-row">
          <span className="dv-lbl">
            <span id="exempt-label">Always allowed (never lock)</span>
            <InfoPop label="About always allowed">
              <p className="ch-pop-p">For a kid&apos;s device that should skip hours and chores, like a school laptop. A manual lock still applies.</p>
            </InfoPop>
          </span>
          <button type="button" role="switch" aria-checked={device.exempt} aria-labelledby="exempt-label" aria-disabled={patch.isPending || undefined}
            onClick={() => !patch.isPending && save({ exempt: !device.exempt })} />
        </div>
      )}
      {device.needs_pins && owners.length > 0 && (
        <div className="pk-note">
          <p>{owners.map(nameOf).join(' and ')} share this device. Add PINs so they can&apos;t sign in as each other.</p>
          <button type="button" className="p-btn" onClick={() => router.push(`/kids?section=kids&kid=${(owners.find((k) => !k.has_pin) ?? owners[0]).id}&pin=1`)}>
            Set PINs
          </button>
        </div>
      )}
    </>
  )
}

/** Activity row's calm line: week bars, the daily average and the hourly pop-over. */
export function ActivityLine({ device }: { device: Device }) {
  const hours = useDailyHours(device)
  return (
    <>
      <WeekBars device={device} />
      {hours !== null && <span className="dv-hrs">Online ~{hours} h a day</span>}
      <InfoPop label="Online by hour" width={340}><OnlineWeek device={device} /></InfoPop>
    </>
  )
}
