import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import { useKids } from '../hooks/useKids'
import { viewAs } from '../kid/viewAs'
import { PointsForm } from '../manage/PointsForm'
import { ActionRow } from '../parent/ActionRow'
import { Icon } from '../parent/Icon'
import { MoreMenu } from '../parent/MoreMenu'
import { EmptyState } from '../parent/states'
import type { Focus } from '../parent/useFocusParam'
import type { NeedsItem, TodayKid } from '../types'
import { ChoreRow } from './ChoreRow'
import { isChore, isGoal, useNeedsActions } from './needsActions'
import { useClock } from './useClock'

const REQ: Record<string, { icon: string; label: string }> = {
  screen_time: { icon: 'timer', label: 'Screen time request' },
  reward: { icon: 'redeem', label: 'Reward request' },
  note: { icon: 'flag', label: 'Note from the kid' },
}

/** A focused kid's day: chores (waiting ones with Approve), requests, and the kid's actions. */
export function KidFocus({ kid, requests, chore }: { kid: TodayKid; requests: NeedsItem[]; chore: Focus }) {
  const router = useRouter()
  const act = useNeedsActions()
  const clock = useClock()
  const full = useKids().data?.find((k) => k.id === kid.id)
  const [points, setPoints] = useState<'bonus' | 'deduct' | null>(null)
  const name = kid.name ?? 'Kid'
  const waitingFor = (id: number, state: string) => (state === 'needs_you' ? requests.find((r) => isChore(r) && r.id === id) : undefined)
  const asks = requests.filter((r) => !isChore(r) && !isGoal(r))
  return (
    <div className="pt-kb">
      <div>
        <div className="p-sec-h">Chores</div>
        {kid.chores.length === 0 ? (
          <EmptyState
            icon="event_available"
            title={`Nothing for ${name} today`}
            body="No chores are due today. Their devices follow the schedule only."
            actions={[{ label: 'Add a chore', icon: 'add', href: '/kids?section=chores&item=new', primary: true }]}
          />
        ) : (
          <div className="pt-box">
            {kid.chores.map((c) => {
              const id = String(c.id)
              return <ChoreRow key={c.id} chore={c} kid={kid} isOpen={chore.isOpen(id)} onToggle={() => chore.toggle(id)} waiting={waitingFor(c.id, c.state)} actions={act} bare />
            })}
          </div>
        )}
      </div>
      <div className="pt-kb-side">
        {asks.length > 0 && (
          <div>
            <div className="p-sec-h">Requests</div>
            <div className="pt-box">
              {asks.map((i) => {
                const t = REQ[i.type] ?? REQ.note
                const note = i.type === 'note'
                return (
                  <ActionRow
                    key={`${i.type}-${i.id}`}
                    icon={t.icon}
                    iconTone="lav"
                    iconLabel={t.label}
                    title={i.title}
                    sub={note ? i.note : `${i.submitted_at ? `Asked ${clock(i.submitted_at)} · ` : ''}${i.cost} pts`}
                    main={note ? { label: 'Reply', onClick: () => act.reply(i) } : { label: 'Approve', onClick: () => act.approve(i), busy: act.busy === `a${i.type}${i.id}`, disabled: !!act.busy }}
                    menu={note ? undefined : [{ label: 'Decline', icon: 'close', tone: 'red', onClick: () => act.decline(i) }]}
                    menuLabel={`More for ${i.title}`}
                  />
                )
              })}
            </div>
          </div>
        )}
        <div className="pt-actbar">
          <Link href="/kids?section=chores&item=new" className="p-btn" data-variant="accent">
            <Icon name="add" size={17} />
            Add chore
          </Link>
          <MoreMenu
            label={`More for ${name}`}
            items={[
              { label: 'Bonus', icon: 'add_circle', takesFocus: true, disabled: !full, onClick: () => setPoints('bonus') },
              { label: 'Deduct', icon: 'remove_circle', takesFocus: true, disabled: !full, onClick: () => setPoints('deduct') },
              { label: 'View as kid', icon: 'visibility', href: viewAs(kid.id, router.asPath) },
              { label: 'Open page', icon: 'open_in_new', href: `/kids?section=kids&item=${kid.id}` },
            ]}
          />
        </div>
        {points && full && <PointsForm key={points} kid={full} kind={points} onClose={() => setPoints(null)} />}
      </div>
    </div>
  )
}
