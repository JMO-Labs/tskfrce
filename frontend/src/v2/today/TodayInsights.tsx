import { useInsights } from '../hooks/useInsights'
import { useKids } from '../hooks/useKids'
import { GoalsCard } from './GoalsCard'
import { WeekCard } from './WeekCard'

/** Goals + This week cards for the Today lower band. Renders nothing until loaded (no flash of zeros). */
export function TodayInsights() {
  const { data } = useInsights()
  const kids = useKids().data
  if (!data) return null
  const list = (Array.isArray(kids) ? kids : []).map((k) => ({ id: k.id, name: k.full_name ?? k.username ?? null }))
  return (
    <div className="pi-band">
      <GoalsCard goals={data.goals} kids={list} />
      <WeekCard week={data.week} />
    </div>
  )
}
