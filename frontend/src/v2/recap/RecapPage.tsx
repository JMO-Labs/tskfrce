import { useState } from 'react'
import { ParentShell } from '@/v2/parent/ParentShell'
import { Icon } from '@/v2/parent/Icon'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { RequireParent } from '@/v2/components/RequireParent'
import { useRecap } from '@/v2/hooks/useRecap'
import { RecapKids } from './RecapKids'
import { RecapLooks } from './RecapLooks'
import { looksOf } from './recapTypes'

const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function RecapBody() {
  const [week, setWeek] = useState<string>()
  const q = useRecap(week)
  const r = q.data
  if (q.isPending) return <Skeleton />
  if (q.isError || !r) return <ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} />
  const looks = looksOf(r.kids)
  return (
    <div className="rc">
      <div className="rc-week">
        <button type="button" className="p-btn" aria-label="Previous week" disabled={!r.prev} onClick={() => setWeek(r.prev ?? undefined)}>
          <Icon name="chevron_left" />
        </button>
        <div className="rc-week-t">
          <h2>{`${day(r.week_start)} – ${day(r.week_end)}`}</h2>
          {!r.next && <small>Latest week</small>}
        </div>
        <button type="button" className="p-btn" aria-label="Next week" disabled={!r.next} onClick={() => setWeek(r.next ?? undefined)}>
          <Icon name="chevron_right" />
        </button>
      </div>
      {looks.length > 0 && <RecapLooks key={`l${r.week_start}`} looks={looks} />}
      {r.kids.length > 0 && (
        <RecapKids key={`k${r.week_start}`} kids={r.kids} line={r.all_good ? 'All good this week. Nothing needs a look.' : r.family_line} />
      )}
    </div>
  )
}

export function RecapPage() {
  return (
    <RequireParent>
      <ParentShell title="Your week">
        <RecapBody />
      </ParentShell>
    </RequireParent>
  )
}
