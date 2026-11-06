import { useRef } from 'react'
import { Icon } from '../parent/Icon'
import type { ScreenOption } from '../rewardTypes'

/** "What for?" radio chips: arrow keys move the selection (roving tabindex). */
export function ScreenFor({ options, value, onChange }: { options: ScreenOption[]; value: number | null; onChange: (id: number | null) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const cur = Math.max(0, options.findIndex((o) => o.group_id === value))
  const go = (e: React.KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    const n = (i + step + options.length) % options.length
    onChange(options[n].group_id)
    refs.current[n]?.focus()
  }
  return (
    <div className="r-for">
      <span className="r-sub" id="r-for-l">What for?</span>
      <div className="r-for-chips" role="radiogroup" aria-labelledby="r-for-l">
        {options.map((o, i) => (
          <button
            key={o.group_id ?? 'all'}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={i === cur}
            tabIndex={i === cur ? 0 : -1}
            className="r-for-chip"
            onClick={() => onChange(o.group_id)}
            onKeyDown={(e) => go(e, i)}
          >
            <Icon name={o.icon} />
            <span className="r-for-t">
              <b className="k-disp">{o.name}</b>
              <small>{o.price} pts / 15 min</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
