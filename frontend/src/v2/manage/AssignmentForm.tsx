import { useEffect, useState } from 'react'
import { useDisclosure } from '@mantine/hooks'
import { useDeleteAssignment, type AssignmentBody, type ChoreMode } from '@/v2/hooks/useChores'
import { DAYS } from '@/v2/days'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import { KidPicker } from '@/v2/parent/KidPicker'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import type { Assignment, Kid } from '@/v2/types'
import { ConfirmDelete } from './ConfirmDelete'
import { useSingle } from './useSingle'
import { toastFail } from '../notify'

const REPEATS = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Some days' },
  { value: 'once', label: 'One time' },
]
const MODES: { value: ChoreMode; label: string; hint: string }[] = [
  { value: 'each', label: 'Each does it', hint: 'every kid gets their own copy and points.' },
  { value: 'race', label: 'First one wins', hint: 'first to finish gets the points.' },
  { value: 'team', label: 'Team effort', hint: 'done together, points shared.' },
]

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

/** What the editor's single Save sends for this form; `dirty` = differs from the saved assignment. */
export interface PendingAssignment {
  id?: number
  body: AssignmentBody
  dirty: boolean
  ready: boolean
}

interface Props {
  kids: Kid[]
  assignment?: Assignment
  /** The chore's Due by (Basics), HH:MM or ''. */
  due: string
  /** Due by was edited: only then does it replace this assignment's own due time. */
  dueTouched?: boolean
  /** Report this form's pending change to the editor. It keeps it while the row is closed; null when dismissed or removed. */
  report: (key: string, p: PendingAssignment | null) => void
  /** Unsaved edits from before the row was closed: the form starts from these instead of the saved assignment. */
  kept?: AssignmentBody
  /** Called after a remove, and by Cancel (shown only when this form can be dismissed). */
  onClose?: () => void
  dismissable?: boolean
}

/** Who does a chore, how often and by when. Add or edit one assignment. */
export function AssignmentForm({ kids, assignment: a, due, dueTouched, report, kept, onClose, dismissable }: Props) {
  const del = useDeleteAssignment()
  const delOnce = useSingle(del)
  const [confirm, { open, close }] = useDisclosure(false)
  const from = kept ?? a
  const [who, setWho] = useState<string[]>(from?.kid_ids.map(String) ?? [])
  const [mode, setMode] = useState<ChoreMode>(from?.mode ?? 'each')
  const [repeat, setRepeat] = useState<string>(from?.repeat.type ?? 'daily')
  const [days, setDays] = useState<string[]>(from?.repeat.days.map(String) ?? [])
  const [date, setDate] = useState(from?.on_date ?? '')

  const ready = who.length > 0 && (repeat !== 'weekly' || days.length > 0) && (repeat !== 'once' || !!date)
  const body: AssignmentBody = {
    kid_ids: who.map(Number),
    mode: who.length > 1 ? mode : 'each',
    repeat: { type: repeat as 'daily' | 'weekly' | 'once', days: repeat === 'weekly' ? days.map(Number).sort() : [] },
    on_date: repeat === 'once' ? date : null,
    due_time: !a || dueTouched ? due || null : (a.due_time?.slice(0, 5) ?? null),
  }
  const same = (x: AssignmentBody) =>
    JSON.stringify([[...x.kid_ids].sort(), x.mode, x.repeat, x.on_date, (x.due_time ?? '').slice(0, 5)]) ===
    JSON.stringify([[...body.kid_ids].sort(), body.mode, body.repeat, body.on_date, body.due_time ?? ''])
  const dirty = a ? !same(a) : who.length > 0
  const key = `a${a?.id ?? 'new'}`
  const sig = JSON.stringify([body, dirty, ready])
  useEffect(() => {
    report(key, { id: a?.id, body, dirty, ready })
    // body is derived from the same state as sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sig])

  return (
    <div className="pk-form">
      <div className="pk-field">
        <KidPicker kids={kids} value={who} onChange={setWho} label="Assign to" />
      </div>
      {who.length > 1 && (
        <div className="pk-field">
          <span className="pk-label ch-lbl">
            With more than one kid
            <InfoPop label="About sharing" width={300}>
              <p className="ch-pop-p">
                {MODES.map((m) => <span key={m.value} className="ch-pop-l"><b>{m.label}</b>: {m.hint}</span>)}
              </p>
            </InfoPop>
          </span>
          <div className="pk-seg">
            <SegmentedControl label="Mode" options={MODES} value={mode} onChange={setMode} />
          </div>
        </div>
      )}
      <div className="pk-field">
        <span className="pk-label">Repeat</span>
        <div className="pk-seg">
          <SegmentedControl label="Repeat" options={REPEATS} value={repeat} onChange={setRepeat} />
        </div>
      </div>
      {repeat === 'weekly' && (
        <div className="pk-days" role="group" aria-label="Days">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              className="pk-day"
              aria-label={FULL_DAYS[i]}
              title={FULL_DAYS[i]}
              aria-pressed={days.includes(String(i))}
              onClick={() => setDays(toggle(days, String(i)))}
            >
              {d[0]}
            </button>
          ))}
        </div>
      )}
      {repeat === 'once' && (
        <label className="pk-field">
          <span className="pk-label">Date</span>
          <input className="pk-input" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
        </label>
      )}
      {dirty && !ready && (
        <span className="pk-hint">{who.length === 0 ? 'Pick who does it.' : repeat === 'weekly' ? 'Pick at least one day.' : 'Pick a date.'}</span>
      )}
      {(dismissable || a) && <div className="pk-actions">
        {dismissable && (
          <button type="button" className="p-btn" onClick={() => (report(key, null), onClose?.())}>
            Cancel
          </button>
        )}
        {a && (
          <>
            <button type="button" className="p-btn pk-push" data-variant="red" onClick={open} disabled={del.isPending}>
              <Icon name="person_remove" />
              Remove
            </button>
            <ConfirmDelete
              opened={confirm}
              title="Remove this assignment?"
              confirmLabel="Remove"
              body="The chore stays in the library. Chores already done stay in history."
              onConfirm={() => delOnce(a.id, { onError: toastFail, onSuccess: () => (report(key, null), onClose?.()) })}
              onClose={close}
            />
          </>
        )}
      </div>}
    </div>
  )
}
