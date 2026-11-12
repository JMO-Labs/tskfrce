import { useState } from 'react'
import type { FocusEvent, PointerEvent } from 'react'

/** Tooltip for chart marks: any element with `data-tip` shows it on hover, tap or keyboard focus. */
export function useTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const show = (e: PointerEvent | FocusEvent) => {
    const el = (e.target as Element).closest('[data-tip]')
    if (!el) return setTip(null)
    const r = el.getBoundingClientRect()
    const p = e as PointerEvent
    setTip({ text: el.getAttribute('data-tip') ?? '', x: p.clientX || r.left + r.width / 2, y: p.clientY || r.top })
  }
  const bind = { onPointerOver: show, onPointerMove: show, onPointerDown: show, onFocus: show, onPointerLeave: () => setTip(null), onBlur: () => setTip(null) }
  const node = tip && (
    <div role="tooltip" className="pi-tip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 240), top: tip.y + 14 }}>
      {tip.text}
    </div>
  )
  return { bind, node }
}
