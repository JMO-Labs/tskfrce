import { useEffect, useRef } from 'react'
import { Icon } from '../parent/Icon'
import type { Focus } from '../parent/useFocusParam'
import type { NeedsItem } from '../types'
import { NeedsYouList } from './NeedsYouList'

/** "Needs you · N" strip that opens the grouped waiting list in place. Stays while open so the last approval can say "All caught up". */
export function NeedsStrip({ items, day, focus }: { items: NeedsItem[]; day?: string; focus: Focus }) {
  const open = focus.isOpen('needs')
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) body.current?.focus({ preventScroll: true }) }, [open])
  if (!items.length && !open) return null
  return (
    <div className="pt-needs" data-open={open ? '' : undefined}>
      <button type="button" className="pt-needs-head" aria-expanded={open} aria-controls={open ? 'needs-body' : undefined} data-focus-head="needs" onClick={() => focus.toggle('needs')}>
        <Icon name="hourglass_empty" size={18} />
        <span className="pt-needs-t">Needs you{items.length > 0 && ` · ${items.length}`}</span>
        <Icon name="chevron_right" size={18} className="pt-needs-chev" />
      </button>
      {open && (
        <div id="needs-body" role="region" aria-label="Needs you" tabIndex={-1} className="pt-needs-body" ref={body}>
          <NeedsYouList items={items} today={day} />
        </div>
      )}
    </div>
  )
}
