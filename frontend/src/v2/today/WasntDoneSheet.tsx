import { useState } from 'react'
import { Checkbox, Modal } from '@mantine/core'
import { Icon } from '../parent/Icon'
import { useFamily } from '../hooks/useFamily'
import { useGivePenalty } from '../hooks/usePenalties'
import type { GiveBody } from '../hooks/usePenalties'
import { useTakeBack } from '../hooks/useTrust'
import { PenaltySheet } from './PenaltySheet'
import { dayName, LEVELS, type TakeBackRun } from '../trustTypes'

interface Props {
  run: TakeBackRun
  /** today's run day, YYYY-MM-DD: an older chore won't come back; empty until known (confirm waits) */
  today: string
  kidName: string
  kidId?: number
  /** the kid's trust level now */
  level?: number
  /** trust mode is on: only then is there a level to lower */
  trustOn?: boolean
  onClose: () => void
}

/** Wasn't done: confirm taking a self-approved chore back; lowering trust is ticked by default. */
export function WasntDoneSheet({ run, today, kidName, kidId, level, trustOn = true, onClose }: Props) {
  const take = useTakeBack()
  const [lower, setLower] = useState(true)
  const [pen, setPen] = useState(false)
  const [draft, setDraft] = useState<GiveBody | null>(null)
  const give = useGivePenalty()
  const penalties = !!useFamily().data?.penalties_enabled && !!kidId
  const older = !!today && run.day < today
  const pts = run.points == null ? 'the points' : `the ${run.points} points`
  const kidMsg = older ? `A parent checked ${run.title} and took its points back.` : `A parent checked ${run.title} and it needs another go.`
  // mounted only while open, so Mantine can't return focus: put it back on the opener ourselves
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  const close = () => {
    onClose()
    requestAnimationFrame(() => opener?.isConnected && opener.focus())
  }
  const withPen = penalties && pen
  const go = () =>
    take.mutate(
      { id: run.id, lower_trust: trustOn && !!level && lower },
      {
        onSuccess: () => {
          if (withPen && draft) give.mutate(draft)
          close()
        },
      },
    )
  return (
    <Modal opened onClose={close} title="Wasn't done?" centered>
      <div className="pt-hh-sheet v2-sheet">
        <p className="v2-body">
          {older ? `This chore was from ${dayName(run.day, today)}, so it won't come back.` : `“${run.title}” goes back on ${kidName}'s list for today, and`}{' '}
          {older ? `${pts[0].toUpperCase()}${pts.slice(1)} it earned come off.` : `${pts} it earned come off.`} If {kidName} already spent them, the balance stops at zero.
        </p>
        {trustOn && !level && <span className="pk-hint">{`${kidName}'s count toward Trusted starts over.`}</span>}
        {trustOn && !!level && (
          <Checkbox
            checked={lower}
            onChange={(e) => setLower(e.currentTarget.checked)}
            label="Also lower trust level"
            description={`${kidName} goes from ${LEVELS[level]} to ${LEVELS[level - 1]}.`}
          />
        )}
        {penalties && (
          <Checkbox checked={pen} onChange={(e) => {
              setPen(e.currentTarget.checked)
              setDraft(null)
            }} label="Give penalty" />
        )}
        {penalties && pen && kidId && (
          // no Give button of its own: "Wasn't done" takes the chore back, then gives this penalty
          <PenaltySheet inline kidIds={[kidId]} from={{ chore_run_id: run.id }} reason={`Said ${run.title} was done`} onClose={() => setPen(false)} onDraft={setDraft} />
        )}
        <span className="pk-hint">{`${kidName} sees: "${kidMsg}"`}</span>
        <div className="pk-actions v2-end">
          <button type="button" className="p-btn" onClick={close}>
            Keep
          </button>
          <button type="button" className="p-btn" data-variant="red" disabled={take.isPending || give.isPending || !today || (withPen && !draft)} aria-busy={take.isPending} onClick={go}>
            <Icon name="undo" size={17} />
            Wasn&apos;t done
          </button>
        </div>
      </div>
    </Modal>
  )
}
