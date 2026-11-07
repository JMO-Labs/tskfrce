const W = 112
const H = 36
const PAD = 5

/** Chores done per week as a small line; the last point is the selected week. */
export function Sparkline({ values }: { values: number[] }) {
  const lo = Math.min(...values)
  const span = Math.max(...values) - lo
  const pts = values.map((v, i) => ({
    x: PAD + (i * (W - 2 * PAD)) / Math.max(1, values.length - 1),
    y: span ? H - PAD - ((v - lo) / span) * (H - 2 * PAD) : H / 2,
  }))
  const last = pts[pts.length - 1]
  const ago = (i: number) => (i === values.length - 1 ? 'This week' : i === values.length - 2 ? 'Last week' : `${values.length - 1 - i} weeks ago`)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Last ${values.length} weeks: ${values.join(', ')}`}>
      <polyline points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
      <circle className="end" cx={last.x} cy={last.y} r="5" />
      {pts.map((p, i) => (
        <circle key={i} className="hit" cx={p.x} cy={p.y} r="9">
          <title>{`${ago(i)}: ${values[i]} chores`}</title>
        </circle>
      ))}
    </svg>
  )
}
