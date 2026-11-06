import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { PROPS } from './catalog'
import { Burst, Legendary, MascotPop, TileAnchor, Word } from './Effects'
import type { CardFx } from './pick'
import { badgeText, type Show } from './plan'
import type { Celebrate } from './useCelebrate'
import s from './celebrate.module.css'

const BASE = { little: 72, kid: 56, teen: 44 }
const HELD: Partial<Record<Show['event']['kind'], string>> = { level: PROPS.trophy, streak: PROPS.fire }

const findTile = (id?: number) => (id == null ? null : document.querySelector<HTMLElement>(`[data-celebrate-id="${id}"]`))

/** The content column (right of the desktop rail), so mascots and words never sit on the sidebar. */
function contentBox() {
  const r = document.querySelector('.k-main')?.getBoundingClientRect()
  return r && r.width > 0 ? { left: r.left, width: r.width } : { left: 0, width: window.innerWidth }
}

/**
 * Animate the real chore tile in place (the mockups' card pop): scroll it into view if needed, put the
 * tile effect class on it, and lay the tag / stamp / shards over its rect. Undone when the moment ends.
 */
function useTile(tile: HTMLElement | null, fx: CardFx | null, freeze: number | null) {
  const anchor = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!tile || !fx) return
    let r = tile.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight) {
      tile.scrollIntoView?.({ block: 'center' })
      r = tile.getBoundingClientRect()
    }
    const a = anchor.current
    if (a) {
      Object.assign(a.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
      a.parentElement?.style.setProperty('--ax', `${r.left + r.width / 2}px`)
      a.parentElement?.style.setProperty('--ay', `${r.top + r.height / 2}px`)
    }
    tile.classList.add(s.tile)
    tile.setAttribute('data-cel-fx', fx)
    if (freeze != null) {
      tile.setAttribute('data-cel-freeze', '')
      tile.style.setProperty('--cel-freeze', `${-freeze}ms`)
    }
    return () => {
      tile.classList.remove(s.tile)
      tile.removeAttribute('data-cel-fx')
      tile.removeAttribute('data-cel-freeze')
      tile.style.removeProperty('--cel-freeze')
      if (!tile.getAttribute('class')) tile.removeAttribute('class')
      if (!tile.getAttribute('style')) tile.removeAttribute('style')
    }
  }, [tile, fx, freeze])
  return anchor
}

function Moment({ show, freeze, balance }: { show: Show; freeze: number | null; balance?: number }) {
  const { event, combo, mode } = show
  const [tile] = useState(() => findTile(event.runId))
  const [box] = useState(contentBox)
  // small with no tile on screen has nothing to pop: the static badge says it instead
  const kind = show.kind === 'small' && !tile ? 'static' : show.kind
  const fx: CardFx | null = !tile ? null : kind === 'small' ? 'pop' : kind === 'full' && combo ? combo.card : null
  const anchor = useTile(tile, fx, freeze)
  const spoken = event.points != null ? `${event.title}: plus ${event.points} points!` : event.title
  const style = { '--cl': `${box.left}px`, '--cw': `${box.width}px`, ...(freeze != null && { '--cel-freeze': `${-freeze}ms` }) } as CSSProperties
  return (
    <div
      className={s.root}
      data-celebrate={kind}
      data-mode={mode}
      data-burst={combo?.legendary ?? combo?.burst}
      data-card={fx ?? undefined}
      data-freeze={freeze != null || undefined}
      style={style}
    >
      <span className="k-sr" role="status">
        {spoken}
      </span>
      {kind === 'static' && <div className={s.badge}>{badgeText(event)}</div>}
      {fx && <TileAnchor ref={anchor} event={event} fx={fx} />}
      {kind === 'full' && combo && (
        <>
          {combo.legendary ? <Legendary fx={combo.legendary} cast={combo.cast} /> : <Burst fx={combo.burst} balance={balance} sparks={combo.sparks} />}
          <Word text={combo.word} color={combo.color} base={BASE[mode]} width={box.width} />
          {combo.mascot && <MascotPop id={combo.mascot} say={combo.say} prop={HELD[event.kind]} style={combo.style} entry={combo.entry} />}
        </>
      )}
    </div>
  )
}

/**
 * Mounted once in the kid app. Never takes taps (pointer-events: none); useCelebrate ends it on any tap.
 * Badges and levels keep their AwardOverlay card, which sits above this layer.
 */
export function CelebrationLayer({ cel, balance }: { cel: Celebrate; balance?: number }) {
  if (!cel.show) return null
  return <Moment key={cel.show.event.key} show={cel.show} freeze={cel.freeze} balance={balance} />
}
