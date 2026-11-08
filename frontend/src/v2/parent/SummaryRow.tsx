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
  /** body, rendered only when open */
  children: ReactNode
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'
const SWIPE_PX = 60

export function SummaryRow({ id, icon, title, summary, line2, aside, info, focus, children }: SummaryRowProps) {
  const open = focus.isOpen(id)
  const body = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)

  const wasOpen = useRef(open)
  useEffect(() => {
    const was = wasOpen.current
    wasOpen.current = open
    // closing unmounts the body, so hand focus back to this row's head (not when another row took over)
    if (was && !open && focus.open === null) document.querySelector<HTMLElement>(`[data-focus-head="${id}"]`)?.focus({ preventScroll: true })
    const el = body.current
    if (!open || !el) return
    ;(el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true })
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [open, id, focus.open])

  const onTouchStart = (e: TouchEvent) => { startY.current = e.touches[0]?.clientY ?? null }
  const onTouchEnd = (e: TouchEvent) => {
    const y0 = startY.current
    startY.current = null
    if (open && y0 !== null && (e.changedTouches[0]?.clientY ?? y0) - y0 > SWIPE_PX) focus.close()
  }

  return (
    <section className="p-srow" data-open={open ? '' : undefined}>
      <div className="p-srow-top">
        <button
          type="button"
          className="p-srow-head"
          aria-expanded={open}
          aria-controls={open ? `srow-${id}-body` : undefined}
          data-focus-head={id}
          onClick={() => focus.toggle(id)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <span className="p-srow-l1">
            {icon}
            <b id={`srow-${id}-title`}>{title}</b>
            <span className="p-srow-val">{summary}</span>
            <Icon name="chevron_right" size={18} className="p-srow-chev" />
          </span>
        </button>
        {aside && <div className="p-srow-aside">{aside}</div>}
        {info && <div className="p-srow-info"><span aria-hidden="true">{title}</span>{info}</div>}
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
export function FocusArea({ focus, label, children }: { focus: Focus; label?: string; children: ReactNode }) {
  return (
    <div className="p-srows" data-focused={focus.open ? '' : undefined} aria-label={label}>
      {children}
    </div>
  )
}
