import { useState } from 'react'
import { Checkbox, Modal } from '@mantine/core'
import { Icon } from '../parent/Icon'
import { useTakeBack } from '../hooks/useTrust'
import { dayName, LEVELS, type TakeBackRun } from '../trustTypes'

interface Props {
  run: TakeBackRun
  /** today's run day, YYYY-MM-DD: an older chore won't come back */
  today: string
  kidName: string
  /** the kid's trust level now */
  level?: number
  onClose: () => void
}

/** Wasn't done: confirm taking a self-approved chore back; lowering trust is ticked by default. */
export function WasntDoneSheet({ run, today, kidName, level, onClose }: Props) {
  const take = useTakeBack()
  const [lower, setLower] = useState(true)
  const older = run.day < today
  const kidMsg = older ? `A parent checked ${run.title} and took its points back.` : `A parent checked ${run.title} and it needs another go.`
  const go = () => take.mutate({ id: run.id, lower_trust: lower }, { onSuccess: onClose })
  return (
    <Modal opened onClose={onClose} title="Wasn't done?" centered>
      <div className="pt-hh-sheet">
        <p>
          {older ? `This chore was from ${dayName(run.day, today)}, so it won't come back.` : `${run.title} goes back on ${kidName}'s list for today, and`}{' '}
          {older ? `The ${run.points} points it earned come off.` : `the ${run.points} points it earned come off.`} If {kidName} already spent them, the balance stops at zero.
        </p>
        <Checkbox
          checked={lower}
          onChange={(e) => setLower(e.currentTarget.checked)}
          label="Also lower trust level"
          description={level ? `${kidName} goes from ${LEVELS[level]} to ${LEVELS[level - 1]}.` : undefined}
        />
        <span className="pk-hint">{`${kidName} sees: "${kidMsg}"`}</span>
        <div className="pk-actions">
          <button type="button" className="p-btn" onClick={onClose}>
            Keep
          </button>
          <button type="button" className="p-btn" data-variant="red" disabled={take.isPending} aria-busy={take.isPending} onClick={go}>
            <Icon name="undo" size={17} />
            Wasn&apos;t done
          </button>
        </div>
      </div>
    </Modal>
  )
}
