import { useState } from 'react'
import type { NeedsItem } from '../types'
import { ActionRow } from '../parent/ActionRow'
import { Chip, type ChipTone } from '../parent/Chip'
import { Icon } from '../parent/Icon'
import { EmptyState } from '../parent/states'
import { dayName } from '../trustTypes'
import { PhotoViewer, useAuthImage } from './PhotoViewer'
import { SendBackBox } from './WaitingActions'
import { groupNeeds } from './needsGroups'
import { initial } from './KidFacts'
import { useClock } from './useClock'
import { isChore, useNeedsActions } from './needsActions'

type Kind = { label: string; icon: string; tone: ChipTone; help: string }
const KIND: Record<NeedsItem['type'], Kind> = {
  chore: { label: 'Needs OK', icon: 'hourglass_empty', tone: 'lav', help: 'Needs OK: they marked it done' },
  redo: { label: 'Redo', icon: 'undo', tone: 'red', help: 'Redo: they tried again' },
  screen_time: { label: 'Screen time', icon: 'timer', tone: 'lav', help: 'Screen time request: spends points' },
  reward: { label: 'Reward', icon: 'redeem', tone: 'lav', help: 'Reward request: spends points' },
  note: { label: 'Note', icon: 'flag', tone: 'lav', help: 'Note from a kid' },
  integration: { label: 'From an integration', icon: 'extension', tone: 'lav', help: 'From an integration' },
  goal_full: { label: 'Goal full', icon: 'flag', tone: 'acc', help: 'Goal full: mark it fulfilled' },
  goal_suggested: { label: 'Goal idea', icon: 'lightbulb', tone: 'lav', help: 'Goal idea: set a price' },
}
const SPOT: Kind = { label: 'Spot check', icon: 'visibility', tone: 'lav', help: 'Spot check: take a look before it counts' }
const ordinal = (n: number) => (n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)

function Thumb({ item, onOpen }: { item: NeedsItem; onOpen: () => void }) {
  const src = useAuthImage(item.thumb_url)
  return (
    <button type="button" className="p-needs-thumb" aria-label={`Open photo for ${item.title}`} onClick={onOpen}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" />}
    </button>
  )
}

/** "Needs you": everything waiting on a parent, grouped by kid, oldest first, one Approve per row.
 *  The server decides what is listed (a note leaves once its flag clears). */
export function NeedsYouList({ items, today }: { items: NeedsItem[]; today?: string }) {
  const clock = useClock()
  const act = useNeedsActions()
  const [viewing, setViewing] = useState<NeedsItem | null>(null)
  const [sending, setSending] = useState<number | null>(null)

  if (items.length === 0) {
    return <EmptyState icon="celebration" tone="acc" title="All caught up" body="Nothing needs your OK right now. Nice." />
  }

  const approvable = items.filter((i) => i.type !== 'note')
  const sub = (i: NeedsItem) => {
    if (i.type === 'note') return i.note ?? ''
    const via = i.integration ? `via ${i.integration.name}` : ''
    const parts = isChore(i)
      ? [i.attempt && i.attempt > 1 ? `${ordinal(i.attempt)} try` : '', i.subtasks_total ? `${i.subtasks_done}/${i.subtasks_total} steps` : '', i.submitted_at ? `Done ${clock(i.submitted_at)}` : '']
      : [i.submitted_at ? `Asked ${clock(i.submitted_at)}` : '', i.device_name ? `from ${i.device_name}` : '', `${i.cost} pts`, `has ${i.kid_balance}`]
    return [...parts, via].filter(Boolean).join(' · ')
  }

  return (
    <div className="pt-needs-list">
      <div className="pt-needs-top">
        <span>Oldest first, grouped by kid</span>
        {approvable.length > 0 && (
          <button type="button" className="p-btn" disabled={!!act.busy} data-loading={act.busy === 'all' || undefined} onClick={() => act.approveAll(approvable)}>
            <Icon name="check" size={15} />
            Approve all
          </button>
        )}
      </div>
      {groupNeeds(items).map((g) => (
        <div key={g.key} className="pt-ngroup" data-testid="needs-group">
          <div className="pt-ngroup-h">
            <span className="pt-ngroup-av" aria-hidden>{initial(g.name)}</span>
            <span className="pt-ngroup-name">{g.name}</span>
          </div>
          {g.items.map((i) => {
            const k = i.spot_check && i.type === 'chore' ? SPOT : KIND[i.type]
            const older = today && i.day && i.day < today && isChore(i) ? dayName(i.day, today) : null
            const note = i.type === 'note'
            const chore = isChore(i)
            const key = `${i.type}-${i.id}`
            return (
              <ActionRow
                key={key}
                icon={i.integration?.icon ?? k.icon}
                iconTone={k.tone}
                iconLabel={k.label}
                iconHelp={i.integration ? `${k.help}: ${i.integration.name} checked it off` : k.help}
                title={
                  <span className="pt-ntitle">
                    {i.thumb_url && <Thumb item={i} onOpen={() => setViewing(i)} />}
                    <span>{i.title}</span>
                    {older && <Chip tone="grey" icon="calendar_today">{older}</Chip>}
                  </span>
                }
                sub={sub(i)}
                main={note ? { label: 'Reply', onClick: () => act.reply(i) } : { label: 'Approve', onClick: () => act.approve(i), busy: act.busy === `a${i.type}${i.id}`, disabled: !!act.busy }}
                menu={note ? undefined : chore
                  ? [{ label: 'Send back', icon: 'undo', onClick: () => setSending(i.id) }, { label: 'Reply', icon: 'chat', onClick: () => act.reply(i) }]
                  : [{ label: 'Decline', icon: 'close', tone: 'red', onClick: () => act.decline(i) }]}
                menuLabel={`More for ${i.title}`}
              >
                {sending === i.id && chore && <SendBackBox item={i} act={act} onClose={() => setSending(null)} />}
              </ActionRow>
            )
          })}
        </div>
      ))}
      <PhotoViewer
        item={viewing}
        photos={viewing?.photos}
        start={Math.max(0, (viewing?.photos?.length ?? 1) - 1)}
        onClose={() => setViewing(null)}
        onApprove={() => viewing && act.approve(viewing)}
        onSendBack={(id, text) => act.sendBack(id, text)}
      />
    </div>
  )
}
