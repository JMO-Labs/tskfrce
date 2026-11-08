import { notifications } from '@mantine/notifications'
import { useTestBlock } from '@/v2/hooks/useDevices'
import { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import { clockText } from '@/v2/clockText'
import { DetailHeader, type StatusChip } from '@/v2/parent/DetailHeader'
import type { MenuItem } from '@/v2/parent/MoreMenu'
import { Icon } from '@/v2/parent/Icon'
import type { Device, Override } from '@/v2/types'
import { ActionButton } from './ActionButton'
import { DEVICE_TYPE_ICON, getDeviceType } from './deviceMeta'
import { toastFail, toastOk } from '../notify'

interface Props {
  device: Device
  locked: boolean
  /** the manual override still in force, if any */
  ov: Override | null | undefined
  timeZone?: string
  /** a new device stays online until assigned, unless strict mode is on */
  blockNew: boolean
  pendingAction: string | null
  onOverride: (action: string) => void
  onActivity: () => void
  onRename: () => void
  onDelete: () => void
}

const popBtn = (icon: string, label: string, onClick: () => void) => (
  <button type="button" className="p-mi ch-edit" onClick={onClick}><Icon name={icon} size={16} />{label}</button>
)

/** The "…" menu: Test block (says Testing… and is off while it runs), Rename, Back to schedule (override only), Delete. */
export function deviceMenu(o: { testing: boolean; hasOverride: boolean; onTest: () => void; onRename: () => void; onSchedule: () => void; onDelete: () => void }): MenuItem[] {
  return [
    { label: o.testing ? 'Testing…' : 'Test block', icon: 'shield', disabled: o.testing, onClick: o.onTest },
    { label: 'Rename', icon: 'edit', takesFocus: true, onClick: o.onRename },
    { label: 'Back to schedule', icon: 'event_repeat', hidden: !o.hasOverride, onClick: o.onSchedule },
    { label: 'Delete', icon: 'delete', tone: 'red', divider: true, onClick: o.onDelete },
  ]
}

/** Device header: type tile, name, the one status chip (its pop-over explains it), the main action and the "…" menu. */
export function DeviceHead({ device, locked, ov, timeZone, blockNew, pendingAction, onOverride, onActivity, onRename, onDelete }: Props) {
  const test = useTestBlock()
  const onceTest = useSingleFlight() // a slow test must not swallow the next save
  const runTest = () =>
    onceTest(() =>
      test.mutateAsync(device.id).then(
        (r) => (r.reason === 'ok' ? toastOk(r.message) : notifications.show({ message: r.message, color: 'fridgeRed' })),
        toastFail,
      ),
    )
  const unlocksAt = ov?.expires_at ? clockText(ov.expires_at, timeZone) : null
  const status: StatusChip = device.resisting
    ? {
        tone: 'red', icon: 'gpp_maybe', label: 'Got around the lock',
        pop: (
          <>
            <p className="ch-pop-p"><b className="ch-ink">Getting around the lock now</b><br />It kept reaching the internet while locked, often through a manual network setting or VPN.</p>
            {popBtn('policy', 'See activity ›', onActivity)}
            {popBtn('lock', 'Lock now', () => onOverride('lock'))}
          </>
        ),
      }
    : locked
      ? {
          tone: 'grey', icon: 'lock', label: 'Locked',
          pop: (
            <>
              <p className="ch-pop-p">{ov?.action === 'lock' ? (unlocksAt ? `Locked by you until ${unlocksAt}.` : 'Locked by you until you unlock it.') : 'Locked by the schedule.'}</p>
              {ov && popBtn('event_repeat', 'Back to schedule', () => onOverride('schedule'))}
            </>
          ),
        }
      : {
          tone: 'acc', icon: 'lock_open', label: 'Open',
          pop: (
            <p className="ch-pop-p">
              {device.locks_at ? `Open and online. Locks at ${clockText(device.locks_at, timeZone)} by schedule.` : 'Open and online.'}
              {device.status === 'unassigned' && (blockNew ? ' This device is new and blocked until you say whose it is.' : ' This device is new. It stays online until you say whose it is.')}
            </p>
          ),
        }
  const busy = (a: string) => pendingAction === a
  return (
    <DetailHeader
      media={<span className="pk-tile pk-tile-lg"><Icon name={DEVICE_TYPE_ICON[getDeviceType(device.name, device.vendor)]} size={30} /></span>}
      title={device.name}
      status={status}
      main={locked ? (
        <ActionButton icon="lock_open" busy={busy('unlock')} disabled={!!pendingAction} onClick={() => onOverride('unlock')}>Unlock 30 min</ActionButton>
      ) : (
        <ActionButton icon="lock" variant="red" busy={busy('lock')} disabled={!!pendingAction} onClick={() => onOverride('lock')}>Lock now</ActionButton>
      )}
      menu={deviceMenu({ testing: test.isPending, hasOverride: !!ov, onTest: runTest, onRename, onSchedule: () => onOverride('schedule'), onDelete })}
    />
  )
}
