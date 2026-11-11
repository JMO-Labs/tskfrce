import { useState } from 'react'
import type { ReactNode } from 'react'
import { useDisclosure } from '@mantine/hooks'
import { clockText } from '@/v2/clockText'
import { useDeleteGroup, useSaveGroup } from '@/v2/hooks/useDevices'
import { useScreenTime } from '@/v2/hooks/useScreenTime'
import { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import { Icon } from '@/v2/parent/Icon'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import type { Device, Group, HourRule, Kid } from '@/v2/types'
import { ConfirmDelete } from './ConfirmDelete'
import { GroupHead } from './GroupHead'
import { GroupNew } from './GroupNew'
import { DevicesBody, HoursBody, SettingsBody } from './GroupRows'
import { nameOf } from './choreMeta'
import { toastFail } from '../notify'

interface Props {
  /** Omit to create a new group. */
  group?: Group
  devices: Device[]
  kids: Kid[]
  groups?: Group[]
  rules?: HourRule[]
  /** Select a group, or null to close the detail. */
  onSelect: (id: number | null) => void
  onRequestOverride: (req: { kind: string; id: number; action: string; minutes?: number }) => void
  /** Family time zone for the next-lock time. */
  timeZone?: string
  /** Override action in flight (lock / unlock / clear), if any. */
  pendingAction?: string | null
}

const ROWS = ['gdev', 'gset', 'ghours']
const ico = (name: string): ReactNode => <Icon name={name} size={18} />

/** Group detail: an existing group is a header over three rows that open one at a time; no group is the new-group form. */
export function GroupDetail(p: Props) {
  return p.group ? <Existing {...p} group={p.group} /> : <GroupNew devices={p.devices} kids={p.kids} onSelect={p.onSelect} />
}

function Existing({ group, devices, kids, groups, rules, onSelect, onRequestOverride, timeZone, pendingAction = null }: Props & { group: Group }) {
  const del = useDeleteGroup()
  const [confirm, { open, close }] = useDisclosure(false)
  const rows = useFocusParam('open', { group: ['net'], valid: (id) => ROWS.includes(id) })
  const st = useScreenTime().data
  // one save guard for every row: each save sends the whole device list, so two at once could undo each other
  const saver = { save: useSaveGroup(), once: useSingleFlight() }
  // Rename: open Settings and ask its name field to take focus (a counter, so it works when Settings is already open)
  const [nameFocus, setNameFocus] = useState(0)
  const rename = () => { rows.openTo('gset'); setNameFocus((n) => n + 1) }

  const members = devices.filter((d) => group.device_ids.includes(d.id))
  const locked = members.filter((d) => !d.online && d.status !== 'guest' && !d.exempt).length
  const memberOwners = members.flatMap((d) => d.owner_ids)
  const owners = kids.filter((k) => memberOwners.includes(k.id)).map(nameOf).join(', ')
  const mine = rules?.filter((r) => r.everyone || r.group_ids.includes(group.id)) ?? []
  const next = members.map((d) => d.locks_at).filter((t): t is string => !!t).sort()[0]
  const price = group.screen_price ?? st?.price
  const sold = !!st?.enabled && !!st?.group_pricing && price != null
  const setText = !group.chore_lock ? 'Free' : sold ? `Chores lock · ${price} pts` : 'Chores lock'
  const hoursText = [`${mine.length} ${mine.length === 1 ? 'rule' : 'rules'}`, next && `next lock ${clockText(next, timeZone)}`].filter(Boolean).join(' · ')

  return (
    <div className="pk-detail dv-detail gd-detail">
      <GroupHead
        group={group}
        icon={group.icon || 'devices'}
        members={members}
        locked={locked}
        owners={owners}
        timeZone={timeZone}
        pendingAction={pendingAction}
        onOverride={(action) => onRequestOverride({ kind: 'group', id: group.id, action })}
        onRename={rename}
        onDelete={open}
      />

      <FocusArea focus={rows} label="Group">
        <SummaryRow
          id="gdev"
          icon={ico('devices')}
          title="Devices"
          summary={`${members.length} of ${devices.length} ${devices.length === 1 ? 'device' : 'devices'}`}
          line2={<span className="p-kn">{members.length ? members.map((d) => d.name).join(', ') : 'No devices in this group yet'}</span>}
          focus={rows}
        >
          <DevicesBody saver={saver} group={group} devices={devices} kids={kids} />
        </SummaryRow>
        <SummaryRow id="gset" icon={ico('tune')} title="Settings" summary={setText} focus={rows}>
          <SettingsBody saver={saver} group={group} pricing={st} nameFocus={nameFocus} />
        </SummaryRow>
        {rules && (
          <SummaryRow id="ghours" icon={ico('schedule')} title="Hours" summary={hoursText} focus={rows}>
            <HoursBody group={group} rules={mine} kids={kids} groups={groups ?? []} />
          </SummaryRow>
        )}
      </FocusArea>

      <ConfirmDelete
        opened={confirm}
        title={`Delete ${group.name}?`}
        body="The devices stay. This group's hours are removed."
        onConfirm={() => !del.isPending && void del.mutateAsync(group.id).then(() => onSelect(null), toastFail)}
        onClose={close}
      />
    </div>
  )
}
