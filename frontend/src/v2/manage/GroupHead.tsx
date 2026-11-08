import { DetailHeader, type StatusChip } from '@/v2/parent/DetailHeader'
import type { MenuItem } from '@/v2/parent/MoreMenu'
import { Icon } from '@/v2/parent/Icon'
import type { Device, Group } from '@/v2/types'
import { ActionButton } from './ActionButton'
import { GroupStats } from './GroupStats'

/** a manual override that has not run out yet */
const liveOverride = (d: Device) => !!d.override && !(d.override.expires_at && new Date(d.override.expires_at).getTime() <= Date.now())

/** The "…" menu: Unlock 30 min, Back to schedule (only while a member has an override), Rename, then Delete group. */
export function groupMenu(o: { canAct: boolean; hasOverride: boolean; onUnlock: () => void; onSchedule: () => void; onRename: () => void; onDelete: () => void }): MenuItem[] {
  return [
    { label: 'Unlock 30 min', icon: 'lock_open', disabled: !o.canAct, onClick: o.onUnlock },
    { label: 'Back to schedule', icon: 'event_repeat', hidden: !o.hasOverride, onClick: o.onSchedule },
    { label: 'Rename', icon: 'edit', takesFocus: true, onClick: o.onRename },
    { label: 'Delete group', icon: 'delete', tone: 'red', divider: true, onClick: o.onDelete },
  ]
}

interface Props {
  group: Group
  icon: string
  members: Device[]
  locked: number
  owners: string
  timeZone?: string
  pendingAction: string | null
  onOverride: (action: string) => void
  onRename: () => void
  onDelete: () => void
}

/** Group header: icon tile, name, one grey status chip (its pop-over holds the stats), Lock group and the "…" menu. */
export function GroupHead({ group, icon, members, locked, owners, timeZone, pendingAction, onOverride, onRename, onDelete }: Props) {
  const status: StatusChip = {
    tone: 'grey',
    icon: 'lock',
    label: members.length ? `${members.length - locked} open · ${locked} locked` : 'No devices',
    pop: (
      <>
        <GroupStats members={members} timeZone={timeZone} />
        {owners && <p className="ch-pop-p">Owners: {owners}</p>}
      </>
    ),
  }
  const idle = !!pendingAction || members.length === 0
  return (
    <DetailHeader
      media={<span className="pk-tile pk-tile-lg"><Icon name={icon} size={30} /></span>}
      title={group.name}
      status={status}
      main={<ActionButton icon="lock" variant="red" busy={pendingAction === 'lock'} disabled={idle} onClick={() => onOverride('lock')}>Lock group</ActionButton>}
      menu={groupMenu({ canAct: !idle, hasOverride: members.some(liveOverride), onUnlock: () => onOverride('unlock'), onSchedule: () => onOverride('schedule'), onRename, onDelete })}
    />
  )
}
