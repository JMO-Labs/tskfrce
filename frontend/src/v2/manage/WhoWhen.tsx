import { useEffect, useState } from 'react'
import { useResetState } from '@/v2/hooks/useResetState'
import { Chip } from '@/v2/parent/Chip'
import { Icon } from '@/v2/parent/Icon'
import type { Kid, LibChore } from '@/v2/types'
import { AssignmentForm, type PendingAssignment } from './AssignmentForm'

/** Body of the Who & when row: one form per assignment of the chore, plus a form to add another. */
export function WhoWhen({
  chore,
  kids,
  due,
  dueTouched,
  report,
  kept,
}: {
  chore: LibChore
  kids: Kid[]
  due: string
  dueTouched?: boolean
  report: (key: string, p: PendingAssignment | null) => void
  /** Pending edits per form key, so closing and reopening the row keeps them. */
  kept: Record<string, PendingAssignment>
}) {
  const [adding, setAdding] = useResetState(false, chore.assignments.length)
  const has = chore.assignments.length > 0
  return (
    <>
      {!has && <p className="pk-hint">Nobody has this chore yet. Pick who does it and how often.</p>}
      {chore.assignments.map((a) => (
        <div key={a.id} className="pk-sub">
          {!a.active && (
            <Chip tone="grey" icon="pause_circle">
              Stopped
            </Chip>
          )}
          <AssignmentForm kids={kids} assignment={a} due={due} dueTouched={dueTouched} report={report} kept={kept[`a${a.id}`]?.dirty ? kept[`a${a.id}`].body : undefined} />
        </div>
      ))}
      {(adding || !has || !!kept.anew?.dirty) && (
        <div className="pk-sub">
          <AssignmentForm key={chore.assignments.length} kids={kids} due={due} dueTouched={dueTouched} report={report} kept={kept.anew?.dirty ? kept.anew.body : undefined} dismissable={has} onClose={() => setAdding(false)} />
        </div>
      )}
      {has && !adding && !kept.anew?.dirty && (
        <div className="pk-actions">
          <button type="button" className="p-btn" onClick={() => setAdding(true)}>
            <Icon name="add" />
            Add another assignment
          </button>
        </div>
      )}
    </>
  )
}
