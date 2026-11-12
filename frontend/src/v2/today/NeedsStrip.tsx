import { useEffect, useRef } from 'react'
import { Icon } from '../parent/Icon'
import type { Focus } from '../parent/useFocusParam'
import type { NeedsItem } from '../types'
import { ageText, STALE_MIN, waitingStats } from './dayTime'
import { NeedsYouList } from './NeedsYouList'
import { useNow } from './useClock'

/** Waiting banner: "N waiting on you · X chores · Y rewards · oldest Zm" with Review, which opens the grouped list in place. Hidden at 0, except while open so the last approval can say "All caught up". */
export function NeedsStrip({ items, day, focus }: { items: NeedsItem[]; day?: string; focus: Focus }) {
  const open = focus.isOpen('needs')
  const body = useRef<HTMLDivElement>(null)
  const now = useNow()
  useEffect(() => { if (open) body.current?.focus({ preventScroll: true }) }, [open])
  if (!items.length && !open) return null
  const w = waitingStats(items, now)
  const parts = [w.chores > 0 && `${w.chores} ${w.chores === 1 ? 'chore' : 'chores'}`, w.rewards > 0 && `${w.rewards} ${w.rewards === 1 ? 'reward' : 'rewards'}`].filter(Boolean)
  const stale = w.oldestMin != null && w.oldestMin > STALE_MIN
  return (
    <div className="pt-needs" data-open={open ? '' : undefined}>
      <div className="pt-banner">
        <Icon name="inbox" size={20} />
        <b className="pt-banner-n">{w.total > 0 ? `${w.total} waiting on you` : 'Nothing waiting'}</b>
        <small className="pt-banner-s">
          {parts.join(' · ')}
          {w.oldestMin != null && (
            <>
              {parts.length > 0 && ' · '}
              <span className="pt-banner-age" data-stale={stale ? '' : undefined}>oldest {ageText(w.oldestMin)}</span>
            </>
          )}
        </small>
        <button type="button" className="pt-review" aria-expanded={open} aria-controls={open ? 'needs-body' : undefined} data-focus-head="needs" onClick={() => focus.toggle('needs')}>
          Review
        </button>
      </div>
      {open && (
        <div id="needs-body" role="region" aria-label="Needs you" tabIndex={-1} className="pt-needs-body" ref={body}>
          <NeedsYouList items={items} today={day} />
        </div>
      )}
    </div>
  )
}
