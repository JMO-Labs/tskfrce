import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useDisclosure } from '@mantine/hooks'
import { clockText } from '@/v2/clockText'
import { useFamily } from '@/v2/hooks/useFamily'
import { useDeleteDevice, useExpired } from '@/v2/hooks/useDevices'
import { Icon } from '@/v2/parent/Icon'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import type { Device, Group, Kid } from '@/v2/types'
import { ConfirmDelete } from './ConfirmDelete'
import { DeviceActivity } from './DeviceActivity'
import { DeviceHead } from './DeviceHead'
import { DeviceNetwork } from './DeviceNetwork'
import { DeviceRightNow } from './DeviceRightNow'
import { ActivityLine, DetailsBody } from './DeviceRows'
import { HomeworkActivity } from './HomeworkActivity'
import { nameOf } from './choreMeta'
import { toastFail } from '../notify'

interface Props {
  device: Device
  kids: Kid[]
  groups?: Group[]
  /** Called after the device is deleted. */
  onDeleted?: () => void
  onRequestOverride: (req: { kind: string; id: number; action: string; minutes?: number }) => void
  /** Override action in flight (lock / unlock / clear), if any. */
  pendingAction?: string | null
}

const ROWS = ['now', 'details', 'network', 'activity']
const ico = (name: string): ReactNode => <Icon name={name} size={18} />

/** Device detail: header (status chip, main action, "…") over four rows that open one at a time. */
export function DeviceDetail({ device, kids, groups = [], onDeleted, onRequestOverride, pendingAction = null }: Props) {
  const del = useDeleteDevice()
  const [confirm, { open, close }] = useDisclosure(false)
  const rows = useFocusParam('open', { valid: (id) => ROWS.includes(id) })
  const family = useFamily().data
  const tz = family?.timezone
  const guest = device.status === 'guest'
  const unknown = device.status === 'unassigned'
  // an override that ran out while the screen was open no longer counts
  const ov = useExpired(device.override?.expires_at) ? null : device.override
  const owned = device.owner_ids.length > 0 && !guest
  const locked = ov?.action === 'lock' || (!device.online && !device.exempt && owned)

  // a new device has no owner: start on Details, where the owner is picked
  useEffect(() => { if (unknown && !rows.open) rows.openTo('details', { replace: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Rename: open Details and ask its Name field to take focus (a counter, so it works when Details is already open)
  const [nameFocus, setNameFocus] = useState(0)
  const rename = () => { rows.openTo('details'); setNameFocus((n) => n + 1) }
  const owners = guest ? 'Guest' : kids.filter((k) => device.owner_ids.includes(k.id)).map(nameOf).join(', ') || 'No owner yet'
  const mine = groups.filter((g) => g.device_ids.includes(device.id)).map((g) => g.name)
  const until = ov?.action === 'lock' ? (ov.expires_at ? `until ${clockText(ov.expires_at, tz)}` : 'until you unlock') : 'on schedule'
  const nowText = locked ? `Locked · ${until}` : device.locks_at ? `Open · locks at ${clockText(device.locks_at, tz)}` : 'Open'
  const alerts = device.alerts > 0 ? `${device.alerts} alert${device.alerts === 1 ? '' : 's'} this week` : 'No alerts this week'

  return (
    <div className="pk-detail dv-detail">
      <DeviceHead
        device={device}
        locked={locked}
        ov={ov}
        timeZone={tz}
        blockNew={family?.new_devices_blocked ?? false}
        pendingAction={pendingAction}
        onOverride={(action, minutes) => onRequestOverride({ kind: 'device', id: device.id, action, minutes })}
        onActivity={() => rows.openTo('activity')}
        onRename={rename}
        onDelete={open}
      />

      <FocusArea focus={rows} label="Device">
        <SummaryRow id="now" icon={ico('schedule')} title="Right now" summary={nowText} focus={rows}>
          <DeviceRightNow device={device} timeZone={tz} />
        </SummaryRow>
        <SummaryRow id="details" icon={ico('tune')} title="Details" summary={[owners, mine.join(', ')].filter(Boolean).join(' · ')} focus={rows}>
          <DetailsBody device={device} kids={kids} groups={groups} nameFocus={nameFocus} />
        </SummaryRow>
        <SummaryRow id="network" icon={ico('wifi')} title="Network" summary={device.ip ? <span className="pk-mono">{device.ip}</span> : 'Not seen yet'} focus={rows}>
          <DeviceNetwork device={device} timeZone={tz} />
        </SummaryRow>
        <SummaryRow id="activity" icon={ico('trending_up')} title="Activity" summary={alerts} line2={guest ? undefined : <ActivityLine device={device} />} focus={rows}>
          <DeviceActivity device={device} kids={kids} timeZone={tz} />
        </SummaryRow>
        {ov?.action === 'homework' && (
          <SummaryRow id="homework" icon={ico('menu_book')} title="Homework activity" summary="Sites used during homework mode" focus={rows}>
            <HomeworkActivity deviceId={device.id} />
          </SummaryRow>
        )}
      </FocusArea>

      <ConfirmDelete
        opened={confirm}
        title={`Delete ${device.name}?`}
        body="It will show up as a new device if it connects again."
        onConfirm={() => !del.isPending && void del.mutateAsync(device.id).then(onDeleted, toastFail)}
        onClose={close}
      />
    </div>
  )
}
