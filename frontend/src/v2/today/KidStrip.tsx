import { Icon } from '../parent/Icon'
import type { TodayKid } from '../types'
import { initial } from './KidFacts'

/** Top of a focused Today: back to all kids, one avatar per kid (lavender count = waiting, tick = all done), Needs total. */
export function KidStrip({ kids, selected, onSelect, onAll, waiting, onNeeds }: {
  kids: TodayKid[]
  selected?: number
  onSelect: (id: number) => void
  onAll: () => void
  waiting: number
  /** Omit when the Needs list itself is open: the pill would point at where you are. */
  onNeeds?: () => void
}) {
  return (
    <nav className="pt-strip" aria-label="Kids">
      <button type="button" className="p-btn" onClick={onAll}>
        <Icon name="chevron_left" size={16} />
        All
      </button>
      {kids.map((k) => {
        const n = k.needs_you_count ?? 0
        const on = k.id === selected
        const allDone = !!k.total && k.done === k.total
        const name = k.name ?? 'Kid'
        return (
          <button key={k.id} type="button" className="pt-strip-kid" aria-pressed={on} aria-label={n > 0 && !on ? `${name}, ${n} waiting` : name} onClick={() => onSelect(k.id)}>
            {initial(k.name)}
            {!on && n > 0 && <i data-tone="lav" aria-hidden>{n}</i>}
            {!on && !n && allDone && (
              <i data-tone="acc" aria-hidden>
                <Icon name="check" size={12} />
              </i>
            )}
          </button>
        )
      })}
      <span className="pt-strip-grow" />
      {onNeeds && (
        <button type="button" className="p-pill" aria-label={`Needs you, ${waiting} waiting`} onClick={onNeeds}>
          <Icon name="hourglass_empty" size={14} />
          {waiting}
        </button>
      )}
    </nav>
  )
}
