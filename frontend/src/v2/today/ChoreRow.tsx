import { useEffect, useRef } from 'react'
import type { NeedsItem, TodayChore, TodayKid } from '../types'
import { Chip } from '../parent/Chip'
import { Icon } from '../parent/Icon'
import { ChoreOpen } from './ChoreOpen'
import { ChoreNote, NoteLine } from './ChoreNote'
import { threadGlyph } from './choreIcon'
import { statusChip } from './statusChip'
import { ownApproved } from '../trustTypes'
import { useClock, useNow } from './useClock'
import type { NeedsActions } from './needsActions'
import { WaitingActions } from './WaitingActions'

const wall = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** "Done 5:40 PM · approved · 3 of 3 steps" / "Due 7:00 PM · 2 of 4 steps" */
export function choreSub(c: TodayChore, clock: (iso: string) => string = (i) => wall(new Date(i))): string {
  const bits: string[] = []
  if (c.done_at) bits.push(`Done ${clock(c.done_at)}`)
  else if (c.due_time) bits.push(`Due ${wall(new Date(`2000-01-01T${c.due_time}`))}`)
  if (c.state === 'done' && !ownApproved(c.approved_via)) bits.push('approved')
  if ((c.subtasks_total ?? 0) > 1) bits.push(`${c.subtasks_done ?? 0} of ${c.subtasks_total} steps`)
  if (c.photos) bits.push(`${c.photos} photo${c.photos > 1 ? 's' : ''}`)
  if (c.messages) bits.push(`${c.messages} message${c.messages > 1 ? 's' : ''}`)
  if (c.taken_by) bits.push(`by ${c.taken_by}`)
  if (c.deducted) bits.push(`−${c.deducted} deducted`)
  return bits.join(' · ')
}

/** One chore: collapsed row; the open body (steps, actions, chat) renders under it. */
export function ChoreRow({
  chore,
  kid,
  isOpen,
  onToggle,
  waiting,
  actions,
  bare,
}: {
  chore: TodayChore
  kid: TodayKid
  isOpen: boolean
  onToggle: () => void
  /** this chore's needs-you item: Approve and "…" replace the Needs OK chip */
  waiting?: NeedsItem
  /** the shared actions for `waiting` (one lock for all rows) */
  actions?: NeedsActions
  /** focused-kid look (mockup): no Approved / To do chips, no points */
  bare?: boolean
}) {
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // after the focus hook has noted the row as the opener
    const f = isOpen ? requestAnimationFrame(() => sheet.current?.focus({ preventScroll: true })) : 0
    return () => cancelAnimationFrame(f)
  }, [isOpen]) // opening moves focus into the sheet
  const ticked = chore.state === 'done' || chore.state === 'needs_you'
  const sub = choreSub(chore, useClock())
  const chips = statusChip(chore, useNow()).filter((c) => !(waiting && c.label === 'Needs OK') && !(bare && ['Approved', 'To do'].includes(c.label)))
  const own = chore.state === 'done' && ownApproved(chore.approved_via)
  const kept = Math.max(0, chore.points - (chore.deducted ?? 0))
  return (
    <div data-testid="chore-row" data-open={isOpen} data-state={chore.state} data-flag={!!chore.note} className="pt-chore" data-bare={bare || undefined}>
      <div className="pt-rowline">
        <button className="pt-row" onClick={onToggle} aria-expanded={isOpen}>
          <span className="pt-car" aria-hidden>
            <Icon name="chevron_right" size={20} />
          </span>
          <span className="pt-ck" data-on={ticked} aria-hidden>
            {ticked && <Icon name="check" size={16} />}
          </span>
          <span className="pt-ty" aria-hidden>
            <Icon name={threadGlyph(chore.type?.glyph, chore.title)} size={18} />
          </span>
          <span className="pt-t">
            <span className="pt-title">{chore.title}</span>
            {(sub || own) && (
              <small>
                {sub}
                {own && (
                  <>
                    {sub && <span className="pt-own-sep"> · </span>}
                    <span className="pt-own">
                      <Icon name="verified" size={14} />
                      Approved on its own
                    </span>
                  </>
                )}
              </small>
            )}
            <NoteLine chore={chore} />
          </span>
          <span className="pt-chips">
            {chips.map((c) => (
              <Chip key={c.label} tone={c.tone} icon={c.icon}>
                {c.label}
              </Chip>
            ))}
          </span>
          <span className="pt-pts">
            {chore.deducted ? (
              <>
                <s>+{chore.points}</s>
                {kept}
              </>
            ) : (
              `+${chore.points}`
            )}
          </span>
        </button>
        {waiting && actions && <WaitingActions item={waiting} name={chore.title} act={actions} />}
      </div>
      <ChoreNote chore={chore} />
      {isOpen && (
        <div ref={sheet} role="region" aria-label={`${chore.title} details`} tabIndex={-1} className="pt-sheetwrap">
          <ChoreOpen chore={chore} kid={kid} />
        </div>
      )}
    </div>
  )
}
