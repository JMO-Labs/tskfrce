import { useState } from 'react'
import type { Goal, GoalBuiltin } from '../goalTypes'

const STEP = 10

/** Inline panel under a goal card: amount stepper, Add / Take back, Remove. */
export function GoalSheet({
  goal,
  free,
  canTake,
  busy,
  onAdd,
  onTake,
  onRemove,
}: {
  goal: Goal
  free: number
  canTake: boolean
  busy: boolean
  onAdd: (n: number) => void
  onTake: (n: number) => void
  onRemove?: () => void
}) {
  const [n, setN] = useState(STEP)
  const max = Math.max(goal.mine, free)
  const amt = Math.max(1, Math.min(n, max || 1))
  return (
    <div className="kg-sheet">
      <div className="kg-step">
        <button type="button" className="kg-sbtn" aria-label="Less" onClick={() => setN(Math.max(1, amt - STEP))}>
          -
        </button>
        <b className="k-disp">{amt.toLocaleString()}</b>
        <button type="button" className="kg-sbtn" aria-label="More" onClick={() => setN(amt + STEP)}>
          +
        </button>
      </div>
      <p className="kg-sub">{`You have ${free.toLocaleString()} points to spare.`}</p>
      <div className="kg-row">
        <button type="button" className="kg-btn" disabled={busy || amt > free} onClick={() => onAdd(amt)}>
          Add
        </button>
        {canTake && (
          <button type="button" className="kg-btn" data-tone="plain" disabled={busy || amt > goal.mine} onClick={() => onTake(amt)}>
            Take back
          </button>
        )}
      </div>
      {onRemove && (
        <button type="button" className="kg-link" onClick={onRemove}>
          Remove goal
        </button>
      )}
    </div>
  )
}

/** Suggest panel: a name box plus built-in goal chips. */
export function SuggestSheet({
  builtins,
  busy,
  onSuggest,
  onStart,
}: {
  builtins: GoalBuiltin[]
  busy: boolean
  onSuggest: (name: string) => void
  onStart: (kind: GoalBuiltin['kind']) => void
}) {
  const [name, setName] = useState('')
  return (
    <div className="kg-sheet">
      <label className="kg-sub" htmlFor="kg-name">
        What do you want to save for?
      </label>
      <input id="kg-name" className="kg-input" maxLength={60} value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <button type="button" className="kg-btn" disabled={busy || !name.trim()} onClick={() => onSuggest(name.trim())}>
        Suggest
      </button>
      {builtins.length > 0 && (
        <div className="kg-chips">
          {builtins.map((b) => (
            <button key={b.kind} type="button" className="kg-chipbtn" disabled={busy} onClick={() => onStart(b.kind)}>
              {`${b.name} · ${b.target.toLocaleString()} points`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
