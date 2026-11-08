import { Skeleton } from '@/v2/parent/states'
import type { Device } from '@/v2/types'
import { useDeviceActivity } from '@/v2/hooks/useDeviceActivity'
import { slotRuns } from './activityText'

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })

/** Activity calm line: 7 mini bars, the time online each day relative to the busiest day, oldest first. */
export function WeekBars({ device }: { device: Device }) {
  const days = [...(useDeviceActivity(device.id).data?.days ?? [])].reverse()
  if (!days.length) return null
  const peak = Math.max(1, ...days.map((d) => d.online_minutes))
  return (
    <span className="dv-wk" role="img" aria-label="Online time, last 7 days">
      {days.map((d) => <i key={d.date} style={{ height: `${Math.max(3, Math.round((d.online_minutes / peak) * 22))}px` }} />)}
    </span>
  )
}

/** Mean online time per day as text ("~3 h", "<1 h"), from the activity feed; null until it loads. */
export function useDailyHours(device: Device): string | null {
  const days = useDeviceActivity(device.id).data?.days
  if (!days?.length) return null
  const h = Math.round(days.reduce((n, d) => n + d.online_minutes, 0) / days.length / 60)
  return h < 1 ? '<1 h' : `~${h} h`
}

/** "Online by hour": one 24 h bar per day (online / locked), newest first. */
export function OnlineWeek({ device }: { device: Device }) {
  const { data, isLoading } = useDeviceActivity(device.id)
  const days = data?.days ?? []
  return (
    <div className="ow-pop" role="region" aria-label="Online this week">
      {isLoading ? (
        <Skeleton rows={1} />
      ) : (
        <>
          <ul className="ow">
            {days.map((d, i) => (
              <li key={d.date} className="ow-row">
                <span>{i === 0 ? 'Today' : weekday(d.date)}</span>
                <div className="ow-track">
                  {slotRuns(d.slots).map((r, j) => (
                    <b key={j} data-state={r.state} style={{ left: `${r.from}%`, width: `${r.to - r.from}%` }} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="ow-ax" aria-hidden="true">
            {['12a', '6a', '12p', '6p', '12a'].map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </div>
          <div className="ph-legend">
            <span><i className="ow-key" data-state="o" />Online</span>
            <span><i className="ow-key" data-state="l" />Locked</span>
            <span><i className="ow-key" />Offline</span>
          </div>
        </>
      )}
    </div>
  )
}
