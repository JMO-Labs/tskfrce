import { useKidPoints } from '@/v2/hooks/useKids'
import { dayTime } from './SelfApprovedList'

/** Points chip pop-over: the last 6 changes, newest first. Fetches only while open. */
export function PointsPop({ kidId }: { kidId: number }) {
  const { data } = useKidPoints(kidId)
  const rows = (Array.isArray(data) ? data : []).slice(0, 6)
  return (
    <div className="kd-pts">
      <div className="p-sec-h">Last 6 changes</div>
      {data && rows.length === 0 && <p className="pk-hint">No points yet. Bonuses and chores show here.</p>}
      {rows.map((p) => (
        <div key={p.id} className="kd-lg">
          <span>{`${dayTime(p.at)} · ${p.label}`}</span>
          <b data-neg={p.amount < 0 || undefined}>{p.amount < 0 ? `−${-p.amount}` : `+${p.amount}`}</b>
        </div>
      ))}
    </div>
  )
}
