import { useState } from 'react'
import type { GoalAction } from '@/v2/hooks/useGoals'
import { useGoalAction, useGoals, usePatchGoalSettings } from '@/v2/hooks/useGoals'
import type { Goal } from '@/v2/goalTypes'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { Fold } from '@/v2/parent/Fold'
import { MoreMenu } from '@/v2/parent/MoreMenu'
import { toastFail, toastOk } from '../notify'
import { GoalForm } from './GoalForm'
import { GoalRow, NumberAsk, nameOf, num } from './GoalRows'

/** Rewards → Goals: what's waiting on the parent, family and kid goals, new goal, settings. */
export function GoalsPane({ onSettings }: { onSettings: () => void }) {
  const q = useGoals()
  const act = useGoalAction()
  const [pricing, setPricing] = useState<number | null>(null)
  const [chipping, setChipping] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const patchSettings = usePatchGoalSettings()
  const run = (id: number, action: GoalAction, done: string, body?: Record<string, unknown>) => act.mutate({ id, action, body }, { onSuccess: () => toastOk(done), onError: toastFail })
  const head = <header className="pk-head"><div className="pk-head-t"><h2>Goals</h2></div></header>
  if (q.isPending) return <div className="pk-detail">{head}<Skeleton rows={2} /></div>
  if (q.isError || !q.data) return <div className="pk-detail">{head}<ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} /></div>
  const { waiting, family, kids, done, settings } = q.data
  return (
    <div className="pk-detail gl-pane">
      {head}
      {!settings.on && (
        <p className="gl-off">Goals are off, so kids don&apos;t see them. <button type="button" className="gl-link" onClick={() => patchSettings.mutate({ on: true }, { onError: toastFail })}>Turn on</button></p>
      )}
      {waiting.length > 0 && (
        <div className="ask">
          <div className="sec">Waiting on you</div>
          {waiting.map((g) => (
            <div key={g.id}>
              <div className="li">
                {g.status === 'full' ? (
                  <span>🎉 {g.kid_name ? `${g.kid_name}'s` : 'The family\'s'} <b>{nameOf(g)}</b> is full</span>
                ) : (
                  <span>{g.kid_name} suggests <b>{nameOf(g)}</b></span>
                )}
                <div className="gl-r">
                  {g.status === 'full' ? (
                    <button type="button" className="pill dark" onClick={() => run(g.id, 'fulfill', 'Fulfilled')}>Fulfilled</button>
                  ) : (
                    <>
                      <button type="button" className="pill" onClick={() => setPricing(pricing === g.id ? null : g.id)}>Set price</button>
                      <MoreMenu label={`More for ${g.name}`} items={[{ label: 'Decline', icon: 'close', tone: 'red', onClick: () => run(g.id, 'decline', 'Declined') }]} />
                    </>
                  )}
                </div>
              </div>
              <NumberAsk label="Price" open={pricing === g.id} onClose={() => setPricing(null)} button="Save price" go={(n) => run(g.id, 'price', 'Price set', { target: n })} />
            </div>
          ))}
        </div>
      )}
      {family.length > 0 && (
        <>
          <div className="sec">Family</div>
          <div className="card">
            {family.map((g) => (
              <GoalRow key={g.id} g={g} chip onPrice={(n) => run(g.id, 'patch', 'Price set', { target: n })} onRemove={() => run(g.id, 'delete', 'Removed')} onChip={(n) => run(g.id, 'chip-in', 'Added', { amount: n })} />
            ))}
          </div>
        </>
      )}
      {kids.length > 0 && (
        <>
          <div className="sec">Kids</div>
          <div className="card">
            {kids.map((g) => (
              <GoalRow key={g.id} g={g} kid onPrice={(n) => run(g.id, 'patch', 'Price set', { target: n })} onRemove={() => run(g.id, 'delete', 'Removed')} />
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
