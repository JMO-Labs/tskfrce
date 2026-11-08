import Link from 'next/link'
import { Tooltip } from '@mantine/core'
import { Icon } from '../parent/Icon'
import { useTipState } from '../hooks/useTips'
import { useHours } from '../hooks/useHours'
import { useParents } from '../hooks/useFamily'
import { TipLine } from './TipLine'
import type { TodayKid } from '../types'

interface Props {
  kids: TodayKid[]
}

function useChecklist(kids: TodayKid[]) {
  const { isDismissed, dismiss } = useTipState()
  const hours = (useHours().data?.rules.length ?? 0) > 0
  const parents = useParents().data?.length ?? 0

  const items = [
    {
      key: 'kid',
      label: 'Add a kid',
      done: kids.length > 0,
      href: '/kids',
      icon: 'person_add',
    },
    {
      key: 'chore',
      label: 'Add chores',
      done: kids.some((k) => (k.chores?.length ?? 0) > 0),
      href: '/kids?section=chores',
      icon: 'task_alt',
    },
    {
      key: 'device',
      label: 'Name devices',
      done: kids.some((k) => k.devices.length > 0),
      href: '/devices',
      icon: 'devices',
    },
    {
      key: 'hours',
      label: 'Set hours',
      done: hours,
      href: '/settings?section=hours',
      icon: 'schedule',
    },
    {
      key: 'other_parent',
      label: 'Invite other parent',
      done: parents > 1,
      href: '/settings?section=parents',
      icon: 'people',
    },
  ]

  const doneCount = items.filter((i) => i.done).length
  const allDone = doneCount === items.length
  const shown = !(allDone || isDismissed('onboard.parent'))
  return { items, doneCount, dismiss, shown }
}

/** Whether the Getting started card is up (so Today can give it the one tip slot). */
export const useChecklistShown = (kids: TodayKid[]): boolean => useChecklist(kids).shown

export function GetStartingChecklistCard({ kids, compact = false }: Props & { compact?: boolean }) {
  const { items, doneCount, dismiss, shown } = useChecklist(kids)
  if (!shown) return null
  if (compact)
    return (
      <TipLine icon="checklist" text={`Getting started · ${doneCount} of ${items.length} done`} label="Getting started" onDismiss={() => dismiss('onboard.parent')}>
        <ul className="p-onboard-items">{items.map((item) => <ChecklistItem key={item.key} item={item} />)}</ul>
      </TipLine>
    )

  return (
    <div className="p-onboard-card" data-testid="parent-onboarding">
      <div className="p-onboard-header">
        <div>
          <h2 className="p-onboard-title">Getting started</h2>
          <p className="p-onboard-progress">
            {doneCount} of {items.length} done
          </p>
        </div>
        <Tooltip label="Dismiss" openDelay={400}>
          <button
            className="p-onboard-dismiss"
            onClick={() => dismiss('onboard.parent')}
            aria-label="Dismiss getting started"
            type="button"
          >
            <Icon name="close" size={18} />
          </button>
        </Tooltip>
      </div>

      <ul className="p-onboard-items">
        {items.map((item) => <ChecklistItem key={item.key} item={item} />)}
      </ul>
    </div>
  )
}

function ChecklistItem({ item }: { item: { key: string; label: string; done: boolean; href: string; icon: string } }) {
  return (
    <li className="p-onboard-item" data-done={item.done}>
      <Link href={item.href}>
        <div className="p-onboard-icon" data-done={item.done}>
          <Icon name={item.done ? 'check' : item.icon} size={16} />
        </div>
        <span className="p-onboard-label">{item.label}</span>
        {!item.done && <Icon name="arrow_forward" size={16} className="p-onboard-arrow" />}
      </Link>
    </li>
  )
}
