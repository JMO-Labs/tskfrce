import { Icon } from '../parent/Icon'
import type { InsightWeek } from './insightsTypes'
import { useTip } from './useTip'

const W = 300
const H = 86
const LO = 50
const HI = 100
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SLOTS = ['AM', 'PM', 'Eve']

const when = (iso: string, today: boolean) => (today ? 'Today' : new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))

function Trend({ week }: { week: InsightWeek }) {
  const n = week.series.length
  const X = (i: number) => (i / (n - 1)) * W
  const Y = (v: number) => H - 6 - ((Math.min(Math.max(v, LO), HI) - LO) / (HI - LO)) * (H - 16)
  // a gap (nothing due) breaks the line instead of dipping to zero
  const runs: { x: number; y: number }[][] = []
  week.series.forEach((p, i) => {
    if (p.rate == null) return void runs.push([])
    if (!runs.length) runs.push([])
    runs[runs.length - 1].push({ x: X(i), y: Y(p.rate) })
  })
  const segs = runs.filter((r) => r.length)
  return (
    <svg className="pi-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="On-time chore rate, last 14 days">
      <line data-goal x1={0} x2={W} y1={Y(week.goal)} y2={Y(week.goal)} stroke="var(--p-line)" strokeDasharray="3 4" />
      <text x={2} y={Y(week.goal) + 12} fontSize={10} fill="var(--p-sub)">{`goal ${week.goal}%`}</text>
      {segs.map((s, i) => (
        <g key={i}>
          {s.length > 1 && <polygon points={`${s[0].x},${H} ${s.map((p) => `${p.x},${p.y}`).join(' ')} ${s[s.length - 1].x},${H}`} className="pi-area" />}
          {s.length > 1 ? <polyline points={s.map((p) => `${p.x},${p.y}`).join(' ')} className="pi-line" vectorEffect="non-scaling-stroke" /> : <circle cx={s[0].x} cy={s[0].y} r={2.5} className="pi-dot" />}
        </g>
      ))}
      {week.series.map((p, i) => (
        <rect
          key={p.day}
          data-trend
          data-tip={p.rate == null ? `${when(p.day, i === n - 1)}: nothing due` : `${when(p.day, i === n - 1)}: ${p.rate}% on time (${p.done} of ${p.total})`}
          x={X(i) - W / n / 2}
          y={0}
          width={W / n}
          height={H}
          fill="transparent"
          tabIndex={0}
        />
      ))}
    </svg>
  )
}

function When({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat())
  const step = (c: number) => (c === 0 ? 0.08 : 0.25 + 0.75 * (Math.ceil((c / max) * 4) / 4))
  return (
    <div className="pi-heat" role="img" aria-label="Chores done by weekday and time of day">
      <div className="pi-heatrow">
        <span />
        {DAYS.map((d) => (
          <span key={d}>{d[0]}</span>
        ))}
      </div>
      {grid.map((row, r) => (
        <div key={SLOTS[r]} className="pi-heatrow">
          <span>{SLOTS[r]}</span>
          {row.map((c, d) => (
            <i key={d} data-cell data-tip={`${DAYS[d]} ${SLOTS[r]}: ${c} ${c === 1 ? 'chore' : 'chores'}`} style={{ opacity: step(c) }} tabIndex={0} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** On-time rate hero, 14-day trend with the 75% goal line, and a single-hue "when chores get done" grid. */
export function WeekCard({ week }: { week: InsightWeek }) {
  const tip = useTip()
  return (
    <section className="pi-card" aria-label="This week" {...tip.bind}>
      <h3 className="pi-ch">
        <Icon name="insights" />
        This week
      </h3>
      {!week.has_history || week.rate == null ? (
        <p className="pi-empty">Your first week shows up here once chores start getting done. Nothing to worry about yet.</p>
      ) : (
        <>
          <div className="pi-hero">
            <b>{week.rate}%</b>
            <span>
              of chores done on time
              {week.delta != null && (
                <>
                  {' · '}
                  <span className="pi-delta">{`${week.delta > 0 ? '+' : week.delta < 0 ? '−' : '±'}${Math.abs(week.delta)} pts vs last week`}</span>
                </>
              )}
            </span>
          </div>
          <Trend week={week} />
          <div className="pi-tlx">
            <span>2 weeks ago</span>
            <span>Today</span>
          </div>
          <p className="pi-sub">When chores get done</p>
          <When grid={week.when} />
        </>
      )}
      {tip.node}
    </section>
  )
}
