import type { ReactNode } from 'react'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import type { ChoreType } from '@/v2/types'
import { ChoreTypePicker } from './ChoreTypePicker'

interface BasicsProps {
  title: string
  onTitle: (v: string) => void
  points: string
  pointsErr: string
  onPoints: (v: string) => void
  types: ChoreType[]
  typeId?: number
  onPick: (id: number) => void
  onEditType: () => void
  onNewType: () => void
}

/** Body of the Basics row: name, type and points. */
export function BasicsBody({ title, onTitle, points, pointsErr, onPoints, types, typeId, onPick, onEditType, onNewType }: BasicsProps) {
  return (
    <>
      <label className="pk-field">
        <span className="pk-label">Chore name</span>
        <input className="pk-input" value={title} maxLength={100} onChange={(e) => onTitle(e.currentTarget.value)} />
      </label>
      <ChoreTypePicker types={types} value={typeId} onPick={onPick} onEdit={onEditType} onNew={onNewType} />
      <label className="pk-field">
        <span className="pk-label">Points</span>
        <input
          className="pk-input ch-w"
          inputMode="numeric"
          aria-label="Points"
          value={points}
          aria-invalid={!!pointsErr}
          aria-describedby={pointsErr ? 'chore-pts-err' : undefined}
          onChange={(e) => onPoints(e.currentTarget.value)}
        />
        {pointsErr && <span id="chore-pts-err" className="pk-error">{pointsErr}</span>}
      </label>
    </>
  )
}

const Setr = ({ icon, label, info, children }: { icon: string; label: string; info?: ReactNode; children: ReactNode }) => (
  <div className="ch-setr">
    <span className="ch-lb"><Icon name={icon} size={16} />{label}{info}</span>
    {children}
  </div>
)

interface OptionsProps {
  /** A new chore has nobody to give a due time to yet. */
  isNew: boolean
  due: string
  /** Assignments have different due times and Due by was not edited. */
  differs: boolean
  onDue: (v: string) => void
  photo: boolean
  onPhoto: (v: boolean) => void
  check: boolean
  onCheck: (v: boolean) => void
}

const Switch = ({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) => (
  <button type="button" className="ch-sw" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
)

/** Body of the Options row: Due by, Needs a photo, Always check. */
export function OptionsBody({ isNew, due, differs, onDue, photo, onPhoto, check, onCheck }: OptionsProps) {
  const hint = isNew ? 'Set after you choose who does it.' : differs ? 'Kids have different times. Set Due by to give them all one time.' : ''
  return (
    <div className="ch-setl">
      <Setr icon="schedule" label="Due by">
        <input className="pk-input ch-w" type="time" aria-label="Due by (optional)" aria-describedby={hint ? 'chore-due-hint' : undefined} value={due} disabled={isNew} onChange={(e) => onDue(e.currentTarget.value)} />
      </Setr>
      {hint && <span id="chore-due-hint" className="pk-hint ch-hint">{hint}</span>}
      <Setr icon="photo_camera" label="Needs a photo" info={<InfoPop label="About photos" width={260}><p className="ch-pop-p">The kid adds a photo when they tick it done. You see it with the Approve button.</p></InfoPop>}>
        <Switch label="Needs a photo" on={photo} onChange={onPhoto} />
      </Setr>
      <Setr icon="visibility" label="Always check" info={<InfoPop label="About always check" width={260}><p className="ch-pop-p">Always waits for your OK, even when the kid is Trusted.</p></InfoPop>}>
        <Switch label="Always check" on={check} onChange={onCheck} />
      </Setr>
    </div>
  )
}
