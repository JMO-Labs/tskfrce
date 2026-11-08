import { useState } from 'react'
import { Tooltip } from '@mantine/core'
import type { NeedsItem } from '../types'
import { openChat } from '../chat/dock'
import { Chip } from '../parent/Chip'
import { Icon } from '../parent/Icon'
import { EmptyState } from '../parent/states'
import { PhotoViewer, useAuthImage } from './PhotoViewer'
import { dayName } from '../trustTypes'
import { useClock } from './useClock'
import { isChore, useNeedsActions } from './needsActions'

const KIND: Record<NeedsItem['type'], { label: string; icon: string; tone: 'lav' | 'red' | 'amb' | 'acc' }> = {
  chore: { label: 'Needs OK', icon: 'hourglass_top', tone: 'lav' },
  redo: { label: 'Redo', icon: 'undo', tone: 'red' },
  screen_time: { label: 'Screen time', icon: 'timer', tone: 'amb' },
  reward: { label: 'Reward', icon: 'redeem', tone: 'amb' },
  note: { label: 'Note', icon: 'flag', tone: 'amb' },
  integration: { label: 'From an integration', icon: 'extension', tone: 'lav' },
}
const SPOT = { label: 'Spot check', icon: 'visibility', tone: 'lav' as const }
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

/** "Needs you": chores, redos, screen time, reward requests and kid notes waiting on a parent, all kids.
 *  The server decides what is listed (a note leaves once its flag clears). */
export function NeedsYouList({ items, today }: { items: NeedsItem[]; today?: string }) {
  const clock = useClock()
  const act = useNeedsActions()
  const { busy } = act
  const [viewing, setViewing] = useState<NeedsItem | null>(null)
  const [sending, setSending] = useState<number | null>(null)
  const [note, setNote] = useState('')

  if (items.length === 0) {
    return <EmptyState icon="celebration" tone="acc" title="All caught up" body="Nothing needs your OK right now. Nice." />
  }

  const approvable = items.filter((i) => i.type !== 'note')
  /** The note box stays open (with its text) if the request fails. */
  const submitSendBack = async (id: number, text: string) => {
    const ok = await act.sendBack(id, text)
    if (ok) (setSending(null), setNote(''))
  }

  return (
    <div className="p-needs-list">
      {approvable.length > 1 && (
        <button type="button" className="p-btn" data-variant="accent" disabled={!!busy} data-loading={busy === 'all'} onClick={() => act.approveAll(approvable)}>
          <Icon name="done_all" size={17} />
          Approve all {approvable.length}
        </button>
      )}
      {items.map((i) => {
        const k = i.spot_check && i.type === 'chore' ? SPOT : KIND[i.type]
        const older = today && i.day && i.day < today && isChore(i) ? dayName(i.day, today) : null
        const chore = isChore(i)
        return (
          <div key={`${i.type}-${i.id}`} className="p-needs-item">
            <div className="p-needs-header">
              {i.thumb_url ? (
                <Thumb item={i} onOpen={() => setViewing(i)} />
              ) : (
                <span className="p-needs-ic">
                  <Icon name={i.integration?.icon ?? k.icon} size={18} />
                </span>
              )}
              <span className="p-needs-t">
                <b>{i.title}</b>
                <small>
                  {i.kid_name ?? 'A kid'}
                  {i.type === 'note'
                    ? `: ${i.note ?? ''}`
                    : chore
                    ? `${i.attempt && i.attempt > 1 ? ` · ${ordinal(i.attempt)} try` : ''}${i.subtasks_total ? ` · ${i.subtasks_done}/${i.subtasks_total} steps` : ''}${i.submitted_at ? ` · ${clock(i.submitted_at)}` : ''}`
                    : `${i.device_name ? ` · from ${i.device_name}` : ''} · ${i.cost} pts · has ${i.kid_balance}`}
                  {i.integration && (
                    <>
                      {' · '}
                      <span className="p-needs-via">via {i.integration.name}</span>
                    </>
                  )}
                </small>
              </span>
              <span className="p-needs-kind">
                <Chip tone={k.tone} icon={k.icon}>
                  {k.label}
                </Chip>
                {older && <Chip tone="grey" icon="calendar_today">{older}</Chip>}
              </span>
            </div>
            {sending === i.id && (
              <input
                className="p-needs-note"
                aria-label="Note for sending back"
                placeholder={`What should ${i.kid_name ?? 'they'} fix?`}
                value={note}
                maxLength={500}
                autoFocus
                onChange={(e) => setNote(e.target.value)}
              />
            )}
            {i.type === 'note' ? (
              <div className="p-needs-actions">
                <button type="button" className="p-btn" onClick={() => act.reply(i)}>
                  <Icon name="chat" size={16} />
                  Reply
                </button>
              </div>
            ) : (
              <div className="p-needs-actions">
                <button type="button" className="p-btn" data-variant="accent" disabled={!!busy} data-loading={busy === `a${i.type}${i.id}`} onClick={() => act.approve(i)}>
                  <Icon name="check" size={16} />
                  Approve
                </button>
                {chore ? (
                  sending === i.id ? (
                    <button type="button" className="p-btn" disabled={!note.trim() || !!busy} data-loading={busy === `s${i.id}`} onClick={() => submitSendBack(i.id, note.trim())}>
                      <Icon name="undo" size={16} />
                      Send back
                    </button>
                  ) : (
                    <button type="button" className="p-btn" onClick={() => (setSending(i.id), setNote(''))}>
                      <Icon name="undo" size={16} />
                      Send back
                    </button>
                  )
                ) : (
                  <button type="button" className="p-btn" data-variant="red" disabled={!!busy} data-loading={busy === `d${i.id}`} onClick={() => act.decline(i)}>
                    <Icon name="close" size={16} />
                    Decline
                  </button>
                )}
                {chore && (
                  <Tooltip label="Open chat" openDelay={400}>
                    <button type="button" className="p-btn" aria-label={`Chat about ${i.title}`} onClick={() => openChat('chore', String(i.id))}>
                      <Icon name="chat" size={16} />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        )
      })}
      <PhotoViewer
        item={viewing}
        photos={viewing?.photos}
        start={Math.max(0, (viewing?.photos?.length ?? 1) - 1)}
        onClose={() => setViewing(null)}
        onApprove={() => viewing && act.approve(viewing)}
        onSendBack={submitSendBack}
      />
    </div>
  )
}
