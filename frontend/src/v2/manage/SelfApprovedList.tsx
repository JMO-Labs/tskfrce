import { useRef, useState } from 'react'
import { Modal } from '@mantine/core'
import { when } from '@/v2/components/bellRules'
import { ActionRow } from '@/v2/parent/ActionRow'
import { Icon } from '@/v2/parent/Icon'
import { useSelfApproved } from '@/v2/hooks/useTrust'
import { threadGlyph } from '@/v2/today/choreIcon'
import { WasntDoneSheet } from '@/v2/today/WasntDoneSheet'
import type { Kid } from '@/v2/types'
import type { SelfApproved, TakeBackRun } from '@/v2/trustTypes'
import { nameOf } from './choreMeta'

/** "Today 5:40 PM", "Yesterday", else "Mon, Oct 20". */
export const dayTime = (iso: string) => {
  const w = when(iso)
  return /^\d/.test(w) ? `Today ${w}` : w
}

function Row({ r, onTake }: { r: SelfApproved; onTake: () => void }) {
  return (
    <ActionRow
      icon={threadGlyph(undefined, r.title)}
      iconLabel="Approved on their own"
      iconHelp="Approved on their own"
      title={r.title}
      sub={`${dayTime(r.approved_at)} · +${r.points}${r.approved_via === 'bedtime' ? ' · at bedtime' : ''}`}
      main={{ label: "Wasn't done", onClick: onTake }}
    />
  )
}

/** "Approved on their own": the 2 newest chores that approved themselves this week; See all lists the week. */
export function SelfApprovedList({ kid, today }: { kid: Kid; today: string }) {
  const rows = useSelfApproved(kid.id).data
  const [all, setAll] = useState(false)
  const seeAll = useRef<HTMLButtonElement>(null)
  const [taking, setTaking] = useState<TakeBackRun | null>(null)
  if (!Array.isArray(rows) || rows.length === 0) return null
  const take = (r: SelfApproved) => {
    if (all) seeAll.current?.focus() // the sheet remembers this as its trigger; the list below is closing
    setAll(false)
    setTaking({ id: r.id, title: r.title, day: r.day, points: r.points })
  }
  return (
    <>
      <div className="v2-sub">
        <span className="v2-sub-t">
          <b>Approved on their own</b>
          <span>{`${rows.length} this week`}</span>
        </span>
        {rows.length > 2 && (
          <button ref={seeAll} type="button" className="p-btn" onClick={() => setAll(true)}>
            <Icon name="chevron_right" size={17} />
            See all
          </button>
        )}
      </div>
      <div className="kd-list">
        {rows.slice(0, 2).map((r) => (
          <Row key={r.id} r={r} onTake={() => take(r)} />
        ))}
      </div>
      <Modal opened={all} onClose={() => setAll(false)} title="Approved on their own" centered>
        <div className="kd-list">
          {rows.map((r) => (
            <Row key={r.id} r={r} onTake={() => take(r)} />
          ))}
        </div>
      </Modal>
      {taking && <WasntDoneSheet run={taking} today={today} kidName={nameOf(kid)} level={kid.trust_level} trustOn={!!kid.trust_mode} onClose={() => setTaking(null)} />}
    </>
  )
}
