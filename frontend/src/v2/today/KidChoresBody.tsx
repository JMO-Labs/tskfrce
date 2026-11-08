import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import { useOnChange } from '@/v2/hooks/useOnChange'
import { viewAs } from '@/v2/kid/viewAs'
import { EmptyState } from '../parent/states'
import { Icon } from '../parent/Icon'
import type { TodayKid } from '../types'
import { ChoreRow } from './ChoreRow'

/** Opened kid's day: actions and chore rows (Task 5 reworks this into the focused body). */
export function KidChoresBody({ kid }: { kid: TodayKid }) {
  const router = useRouter()
  const runId = Number(router.query.chore) || null // ?chore=<run id> (from a notification) opens that chore
  const [openId, setOpenId] = useState<number | null>(runId)
  useOnChange(runId, (id) => id && setOpenId(id))
  return (
    <>
      <div className="pt-head-acts">
        <Link href={viewAs(kid.id, router.asPath)} className="p-btn">
          <Icon name="visibility" size={17} />
          View as kid
        </Link>
        <Link href="/kids?section=chores&item=new" className="p-btn" data-variant="accent">
          <Icon name="add" size={17} />
          Add chore
        </Link>
      </div>
      {kid.chores.length === 0 ? (
        <EmptyState
          icon="event_available"
          title={`Nothing for ${kid.name ?? 'them'} today`}
          body="No chores are due today. Their devices follow the schedule only."
          actions={[{ label: 'Add a chore', icon: 'add', href: '/kids?section=chores&item=new', primary: true }]}
        />
      ) : (
        <div className="pt-box">
          {kid.chores.map((c) => (
            <ChoreRow key={c.id} chore={c} kid={kid} isOpen={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
          ))}
        </div>
      )}
    </>
  )
}
