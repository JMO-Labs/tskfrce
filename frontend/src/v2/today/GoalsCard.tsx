import type { CSSProperties } from 'react'
import { badgesFor } from '@/v2/KidAv'
import { Icon } from '../parent/Icon'
import type { InsightGoal } from './insightsTypes'
import { useTip } from './useTip'

export function etaText(d: number | null): string {
  if (d == null) return 'no pace yet'
  if (d === 0) return 'ready'
  if (d === 1) return '~1 day'
  if (d < 14) return `~${d} days`
  return `~${Math.round(d / 7)} weeks`
}

/** Active goals across kids, closest first. Kid color lives only in the name bubble; bars are the accent. */
export function GoalsCard({ goals, kids }: { goals: InsightGoal[]; kids: { id: number; name: string | null }[] }) {
  const badge = badgesFor(kids)
  const tip = useTip()
  const sorted = [...goals].sort((a, b) => b.pct - a.pct || a.id - b.id)
  return (
    <section className="pi-card" aria-label="Goals" {...tip.bind}>
      <h3 className="pi-ch">
        <Icon name="flag" />
        Goals <span className="pi-sp" />
        <small>closest first</small>
      </h3>
      {sorted.length === 0 ? (
        <p className="pi-empty">No goals yet. When a kid starts saving for something, it shows up here.</p>
      ) : (
        <ul className="pi-goals">
          {sorted.map((g) => {
            const kid = g.kid_id == null ? null : kids.find((k) => k.id === g.kid_id)
            const b: { label: string; style?: CSSProperties } = g.kid_id == null ? { label: 'All' } : badge(g.kid_id, kid?.name ?? null)
            return (
              <li key={g.id} className="pi-gl" data-tip={`${g.saved} of ${g.target} points saved`} tabIndex={0}>
                <span className="pi-av" style={b.style}>{b.label}</span>
                <span className="pi-glbody">
                  <b>
                    {g.name}
                    <em>
                      {g.pct}% · {etaText(g.eta_days)}
                    </em>
                  </b>
                  <span className="pi-track" role="progressbar" aria-label={`${g.name} progress`} aria-valuenow={g.pct} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${g.pct}%` }} />
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {tip.node}
    </section>
  )
}
