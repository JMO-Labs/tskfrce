const C = 2 * Math.PI * 12

/** Small progress ring with "x of y" next to it. */
export function ProgressRing({ done, total }: { done: number; total: number }) {
  const frac = total > 0 ? Math.min(1, done / total) : 0
  return (
    <span className="p-ring" role="img" aria-label={`${done} of ${total} done`}>
      <svg viewBox="0 0 30 30" aria-hidden="true">
        <circle className="p-ring-t" cx="15" cy="15" r="12" fill="none" strokeWidth="4" />
        <circle className="p-ring-f" cx="15" cy="15" r="12" fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} />
      </svg>
      {done} of {total}
    </span>
  )
}
