import { useState } from 'react'
import { useKidGoalAction, useKidGoals } from '../hooks/useKidGoals'
import type { Goal } from '../goalTypes'
import { GoalSheet, SuggestSheet } from './GoalSheet'
import type { KidAge } from './modes/types'

const n = (x: number) => x.toLocaleString()

/** "My goals" on the kid Rewards tab. Look: mockup goals-v1.html (.goal/.bar/.kbtn). */
export function KidGoals({ onExpired, mode = 'kid' }: { onExpired: () => void; mode?: KidAge }) {
  const { data: d } = useKidGoals(onExpired)
  const act = useKidGoalAction(onExpired)
  const [open, setOpen] = useState<number | 'suggest' | null>(null)
  if (!d || !d.on || (d.goals.length === 0 && !d.suggest && d.builtins.length === 0)) return null
  const run = (id: number | undefined, action: 'add' | 'withdraw' | 'auto' | 'delete', body?: Record<string, unknown>) =>
    act.mutate({ id, action, body }, { onSuccess: () => action !== 'auto' && setOpen(null) })
  const note = (g: Goal) => {
    if (g.status === 'full') return `Goal reached! Waiting on ${g.waiting_on ?? 'a parent'}`
    if (g.status === 'suggested') return 'Waiting for a price'
    if (g.id === d.auto_goal_id) return `${d.auto_pct}% of every chore goes here`
    if (g.family && g.siblings) return g.siblings.map((s) => `${s.name} ${n(s.amount)}`).join(', ')
    if (g.family) return `You gave ${n(g.mine)}`
    return ''
  }
  return (
    <section className="kg-view" data-mode={mode}>
      <h2 className="kg-head k-disp">My goals</h2>
      {d.goals.map((g) => {
        const pct = g.target ? Math.min(g.saved / g.target, 1) * 100 : 0
        const addable = g.status === 'active'
        return (
          <div key={g.id} className="kg-goal" data-kind={g.family ? 'fam' : g.status === 'full' ? 'full' : 'own'}>
            <div className="kg-t">
              <b className="k-disp">
                {g.emoji && <span aria-hidden>{`${g.emoji} `}</span>}
                {g.name}
                {g.family && <span className="kg-chip">Family</span>}
              </b>
              <span className="kg-n">{g.target ? `${n(g.saved)} / ${n(g.target)}` : ''}</span>
            </div>
            <div className="kg-bar" role="progressbar" aria-label={`Progress toward ${g.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="kg-acts">
              <span>
                {note(g)}
                {g.status === 'active' && d.auto && g.id !== d.auto_goal_id && (
                  <button type="button" className="kg-link" onClick={() => run(g.id, 'auto')}>
                    Auto-save here
                  </button>
                )}
              </span>
              {g.status === 'full' && <span aria-hidden>🎉</span>}
              {addable && (
                <button type="button" className="kg-btn" onClick={() => setOpen(open === g.id ? null : g.id)}>
                  + Add
                </button>
              )}
            </div>
            {open === g.id && (
              <GoalSheet
                goal={g}
                free={d.free}
                busy={act.isPending}
                canTake={d.withdraw && !g.family && g.status === 'active'}
                onAdd={(amount) => run(g.id, 'add', { amount })}
                onTake={(amount) => run(g.id, 'withdraw', { amount })}
                onRemove={g.family ? undefined : () => run(g.id, 'delete')}
              />
            )}
          </div>
        )
      })}
      {d.can_add && (d.suggest || d.builtins.length > 0) && (
        <>
          <button type="button" className="kg-suggest" onClick={() => setOpen(open === 'suggest' ? null : 'suggest')}>
            {d.suggest ? '+ Suggest a goal' : '+ Pick a goal'}
          </button>
          {open === 'suggest' && (
            <SuggestSheet
              builtins={d.builtins}
              suggest={d.suggest}
              busy={act.isPending}
              onSuggest={(name) => act.mutate({ action: 'suggest', body: { name } }, { onSuccess: () => setOpen(null) })}
              onStart={(kind) => act.mutate({ action: 'start', body: { kind } }, { onSuccess: () => setOpen(null) })}
            />
          )}
        </>
      )}
      {d.done.length > 0 && (
        <>
          <h3 className="kg-sub2 k-disp">Done</h3>
          <ul className="kg-done">
            {d.done.map((g) => (
              <li key={g.id}>{`✓ ${g.emoji ? `${g.emoji} ` : ''}${g.name}`}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
