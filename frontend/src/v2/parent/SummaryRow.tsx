import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react'
import { Icon } from './Icon'
import type { Focus } from './useFocusParam'

export interface SummaryRowProps {
  id: string
  icon: ReactNode
  title: ReactNode
  summary: ReactNode
  /** second calm line, after (not inside) the head button; hidden while another row is open */
  line2?: ReactNode
  /** control right of the head, outside the toggle button (e.g. a Switch) */
  aside?: ReactNode
  /** (i) button shown right after the title, outside the toggle button (a button cannot sit inside a button) */
  info?: ReactNode
  focus: Focus
  /** the summary is still loading: a quiet bar of the same height shows instead, so the row never changes size */
  loading?: boolean
  /** body, rendered only when open */
  children: ReactNode
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'
const SWIPE_PX = 60

export function SummaryRow({ id, icon, title, summary, line2, aside, info, focus, loading, children }: SummaryRowProps) {
  const open = focus.isOpen(id)
  const body = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)

  const wasOpen = useRef(open)
  useEffect(() => {
    const was = wasOpen.current
    const opening = !was && open
    wasOpen.current = open
    // closing unmounts the body, so hand focus back to this row's head (not when another row took over)
    if (was && !open && focus.open === null) document.querySelector<HTMLElement>(`[data-focus-head="${id}"]`)?.focus({ preventScroll: true })
    const el = body.current
    if (!open || !el) return
    // Opened by a click or key press: the first control. Already open on mount (a URL): the region itself (tabindex=-1,
    // outline none), since a fresh load counts as keyboard modality and a control would show its ring.
    const target = opening ? el.querySelector<HTMLElement>(FOCUSABLE) ?? el : el
    target.focus({ preventScroll: true })
    // Bring the whole row (head and body) into view; the other rows fold at once, so the target is already final.
    // A row taller than the screen lines its head up at the top instead of its end at the bottom.
    // A page that loads with this row already open (a link) stays put when the head is in view: its content is still arriving.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const row = el.closest<HTMLElement>('.p-srow') ?? el
    const at = row.querySelector('.p-srow-top')?.getBoundingClientRect()
    if (!opening && at && at.top >= 0 && at.bottom <= window.innerHeight) return
    row.scrollIntoView({ block: row.offsetHeight > window.innerHeight * 0.7 ? 'start' : 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [open, id, focus.open])

  const onTouchStart = (e: TouchEvent) => { startY.current = e.touches[0]?.clientY ?? null }
  const onTouchEnd = (e: TouchEvent) => {
    const y0 = startY.current
    startY.current = null
    if (open && y0 !== null && (e.changedTouches[0]?.clientY ?? y0) - y0 > SWIPE_PX) focus.close()
  }

  return (
    <section className="p-srow" data-open={open ? '' : undefined}>
      <div className="p-srow-top" data-aside={aside ? '' : undefined}>
        <button
          type="button"
          className="p-srow-head"
          aria-expanded={open}
          aria-busy={loading || undefined}
          aria-controls={open ? `srow-${id}-body` : undefined}
          data-focus-head={id}
          onClick={() => focus.toggle(id)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <span className="p-srow-l1">
            {icon}
            <b id={`srow-${id}-title`}>{title}</b>
            <span className="p-srow-val">{loading ? <i className="p-srow-sk" aria-hidden="true" /> : summary}</span>
            <Icon name="chevron_right" size={18} className="p-srow-chev" />
          </span>
        </button>
        {aside && <div className="p-srow-aside">{aside}</div>}
        {info && <div className="p-srow-info"><span className="p-srow-info-i" aria-hidden="true" /><span aria-hidden="true">{title}</span>{info}</div>}
      </div>
      {line2 && (!focus.open || open) && <div className="p-srow-l2">{line2}</div>}
      {open && (
        <div id={`srow-${id}-body`} role="region" aria-labelledby={`srow-${id}-title`} tabIndex={-1} className="p-srow-body" ref={body}>
          {children}
        </div>
      )}
    </section>
  )
}

/** Wraps a group of SummaryRows; CSS keeps the closed rows to one line while one is open. */
/** `grouped`: one card with dividers and a left bar on the open row. */
export function FocusArea({ focus, label, grouped, children }: { focus: Focus; label?: string; grouped?: boolean; children: ReactNode }) {
  return (
    <div className="p-srows" data-focused={focus.open ? '' : undefined} data-grp={grouped ? '' : undefined} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  )
}
