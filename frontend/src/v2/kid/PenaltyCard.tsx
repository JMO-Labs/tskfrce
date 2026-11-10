import { useEffect } from 'react'
import { useSeenPenalty } from '../hooks/usePenalties'
import { kidTitle } from '../penaltyTypes'
import type { KidPenalty } from '../penaltyTypes'

type Done = { mutate: (id: number) => void; isPending: boolean }

function Card({ p, done }: { p: KidPenalty; done: Done }) {
  const seen = useSeenPenalty()
  const none = p.back_total === 0
  useEffect(() => {
    if (none && !p.seen_by_kid) seen.mutate(p.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, none])
  const n = p.makeup.length
  const nDone = p.makeup.filter((m) => m.status === 'done').length
  const pct = none ? 0 : Math.min(100, Math.round((p.amount_returned / p.back_total) * 100))
  return (
    <div className="k-pen" data-testid="penalty-card">
      <h3>{kidTitle(p, new Date())}</h3>
      <div className="k-pen-by">{p.reason ? `“${p.reason}”, ${p.by_name}` : p.by_name}</div>
      {!none && (
        <div className="k-pen-meter" role="progressbar" aria-valuemin={0} aria-valuemax={p.back_total} aria-valuenow={p.amount_returned} aria-label="Earned back">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {n > 0 && (
        <div className="k-pen-line">
          <span>
            {p.makeup.map((m) =>
              m.status === 'done' ? (
                <span key={m.run_id}>✓ {m.title}</span>
              ) : m.status === 'submitted' ? (
                <span key={m.run_id}>… {m.title}</span>
              ) : (
                <button key={m.run_id} type="button" className="k-pen-todo" disabled={done.isPending} onClick={() => done.mutate(m.run_id)}>
                  ○ {m.title}
                </button>
              ),
            )}
          </span>
          <span>{`${nDone} of ${n} done`}</span>
        </div>
      )}
    </div>
  )
}

/** Active penalties on the kid's chores tab: what was lost, why, how to earn it back (penalties-v2 mockup, Ivy's view). */
export function PenaltyCards({ list, done }: { list?: KidPenalty[]; done: Done }) {
  if (!list?.length) return null
  return (
    <>
      {list.map((p) => (
        <Card key={p.id} p={p} done={done} />
      ))}
    </>
  )
}
