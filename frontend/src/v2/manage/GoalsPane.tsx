import { useState } from 'react'
import { useGoalAction, useGoals } from '@/v2/hooks/useGoals'
import type { Goal } from '@/v2/goalTypes'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { Fold } from '@/v2/parent/Fold'
import { toastFail } from '../notify'
import { GoalForm } from './GoalForm'

const num = (n: number | null) => (n ?? 0).toLocaleString()
const pct = (g: Goal) => Math.min(100, g.target ? Math.round((g.saved / g.target) * 100) : 0)

function Mini({ g }: { g: Goal }) {
  return <div className="mini" role="img" aria-label={`${pct(g)}% saved`}><i style={{ width: `${pct(g)}%` }} /></div>
}

/** A pill that opens a small number input; `go` gets the number. */
function NumberAsk({ label, open, onClose, button, go }: { label: string; open: boolean; onClose: () => void; button: string; go: (n: number) => void }) {
  const [v, setV] = useState('')
  if (!open) return null
  return (
    <div className="gl-ask">
      <input className="pk-input" type="number" min={1} inputMode="numeric" aria-label={label} value={v} onChange={(e) => setV(e.currentTarget.value)} />
      <button type="button" className="pill dark" disabled={!(Number(v) > 0)} onClick={() => { go(Number(v)); setV(''); onClose() }}>{button}</button>
    </div>
  )
}

/** Rewards → Goals: what's waiting on the parent, family and kid goals, new goal, settings. */
export function GoalsPane({ onSettings }: { onSettings: () => void }) {
  const q = useGoals()
  const act = useGoalAction()
  const [pricing, setPricing] = useState<number | null>(null)
  const [chipping, setChipping] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const run = (id: number, action: 'fulfill' | 'price' | 'chip-in', body?: Record<string, unknown>) => act.mutate({ id, action, body }, { onError: toastFail })
  const head = <header className="pk-head"><div className="pk-head-t"><h2>Goals</h2></div></header>
  if (q.isPending) return <div className="pk-detail">{head}<Skeleton rows={2} /></div>
  if (q.isError || !q.data) return <div className="pk-detail">{head}<ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} /></div>
  const { waiting, family, kids, done, settings } = q.data
  return (
    <div className="pk-detail gl-pane">
      {head}
      {waiting.length > 0 && (
        <div className="ask">
          <div className="sec">Waiting on you</div>
          {waiting.map((g) => (
            <div key={g.id}>
              <div className="li">
                {g.status === 'full' ? (
                  <span>🎉 {g.kid_name ? `${g.kid_name}'s` : 'The family\'s'} <b>{g.name}</b> is full</span>
                ) : (
                  <span>{g.kid_name} suggests <b>{g.name}</b></span>
                )}
                {g.status === 'full' ? (
                  <button type="button" className="pill dark" onClick={() => run(g.id, 'fulfill')}>Fulfilled</button>
                ) : (
                  <button type="button" className="pill" onClick={() => setPricing(pricing === g.id ? null : g.id)}>Set price</button>
                )}
              </div>
              <NumberAsk label="Price" open={pricing === g.id} onClose={() => setPricing(null)} button="Save price" go={(n) => run(g.id, 'price', { target: n })} />
            </div>
          ))}
        </div>
      )}
      {family.length > 0 && (
        <>
          <div className="sec">Family</div>
          <div className="card">
            {family.map((g) => (
              <div key={g.id}>
                <div className="li">
                  <div>{g.name}<Mini g={g} /></div>
                  <button type="button" className="pill" onClick={() => setChipping(chipping === g.id ? null : g.id)}>+ Chip in</button>
                </div>
                <NumberAsk label="Amount" open={chipping === g.id} onClose={() => setChipping(null)} button="Add" go={(n) => run(g.id, 'chip-in', { amount: n })} />
              </div>
            ))}
          </div>
        </>
      )}
      {kids.length > 0 && (
        <>
          <div className="sec">Kids</div>
          <div className="card">
            {kids.map((g) => (
              <div className="li" key={g.id}>
                <div>{g.kid_name} · {g.name}<Mini g={g} /></div>
                <small>{num(g.saved)} / {num(g.target)}</small>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="card">
        <button type="button" className="li gl-new" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          <span>+ New goal</span>
          <small>custom or built-in</small>
        </button>
        {adding && <GoalForm settings={settings} onDone={() => setAdding(false)} />}
      </div>
      {done.length > 0 && (
        <Fold title="Done" count={done.length}>
          {done.slice(0, 10).map((g) => (
            <div className="li" key={g.id}><span>{g.emoji} {g.kid_name ? `${g.kid_name} · ` : ''}{g.name}</span><small>{num(g.target)}</small></div>
          ))}
        </Fold>
      )}
      <button type="button" className="setl" onClick={onSettings}>Goal settings</button>
    </div>
  )
}
