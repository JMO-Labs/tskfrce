import { useState } from 'react'
import Link from 'next/link'
import { ParentShell } from '@/v2/parent/ParentShell'
import { Icon } from '@/v2/parent/Icon'
import { EmptyState, ErrorPanel, Skeleton } from '@/v2/parent/states'
import { RequireParent } from '@/v2/components/RequireParent'
import { useRecap } from '@/v2/hooks/useRecap'
import { RecapKids } from './RecapKids'
import { RecapLooks } from './RecapLooks'
import { looksOf } from './recapTypes'
import { useFamily } from '@/v2/hooks/useFamily'
import { useDismissTip, useTips } from '@/v2/hooks/useTips'
import styles from '../components/QuickTip.module.css'

const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function RecapBody() {
  const [week, setWeek] = useState<string>()
  const q = useRecap(week)
  const tips = useTips().data
  const dismiss = useDismissTip()
  const recapOff = useFamily().data?.recap_weekly === false
  const r = q.data
  if (q.isPending) return <Skeleton />
  if (q.isError || !r) return <ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} />
  const looks = looksOf(r.kids)
  return (
    <div className="rc">
      {tips && !tips.dismissed.includes('intro.recap') && (
        <section className={`rc-tip ${styles.tip} ${styles.parentMode}`} aria-label="About the recap">
          <span className={styles.icon} aria-hidden="true">
            <span className="material-symbols-rounded">calendar_month</span>
          </span>
          <span className={styles.text}>{recapOff ? 'Weekly recap is off. Turn it on in' : 'New every Sunday at 7:30 PM. Turn it off in'} <Link href="/settings?section=family">Settings › Family</Link>.</span>
          <button type="button" className="p-btn" onClick={() => {
              dismiss.mutate('intro.recap')
              // the tip unmounts: park focus on the week picker instead of <body>
              requestAnimationFrame(() => document.querySelector<HTMLElement>('.rc-week .p-btn:not([disabled])')?.focus())
            }}>
            Got it
          </button>
        </section>
      )}
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
      {r.kids.length === 0 && (
        <EmptyState icon="insights" title="No kids yet" body="Add a kid and their week shows up here." actions={[{ label: 'Add a kid', icon: 'person_add', href: '/kids?section=kids' }]} />
      )}
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
