import type { CSSProperties } from 'react'
import { Burst, Card, Legendary, MascotPop, Word } from './Effects'
import { badgeText } from './plan'
import type { Celebrate } from './useCelebrate'
import s from './celebrate.module.css'

const BASE = { little: 72, kid: 56, teen: 44 }

/**
 * Mounted once in the kid app. Never takes taps (pointer-events: none); useCelebrate ends it on any tap.
 * Badges and levels keep their AwardOverlay card, which sits above this layer.
 */
export function CelebrationLayer({ cel, balance }: { cel: Celebrate; balance?: number }) {
  const { show, freeze } = cel
  if (!show) return null
  const { event, kind, combo, mode } = show
  const spoken = event.points != null ? `${event.title}: plus ${event.points} points!` : event.title
  const style = freeze != null ? ({ '--cel-freeze': `${-freeze}ms` } as CSSProperties) : undefined
  return (
    <div
      key={event.key}
      className={s.root}
      data-celebrate={kind}
      data-mode={mode}
      data-burst={combo?.legendary ?? combo?.burst}
      data-card={combo?.card}
      data-freeze={freeze != null || undefined}
      style={style}
    >
      <span className="k-sr" role="status">
        {spoken}
      </span>
      {kind === 'static' && <div className={s.badge}>{badgeText(event)}</div>}
      {kind === 'small' && <Card event={event} fx="pop" />}
      {kind === 'full' && combo && (
        <>
          {combo.legendary ? <Legendary fx={combo.legendary} /> : <Burst fx={combo.burst} balance={balance} />}
          <Card event={event} fx={combo.card} />
          <Word text={combo.word} color={combo.color} base={BASE[mode]} />
          {combo.mascot && <MascotPop id={combo.mascot} say={combo.say} />}
        </>
      )}
    </div>
  )
}
