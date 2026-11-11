/** Power-up slot row (mockup 4 .pups): held power-ups, the armed one lit, dashed "+" for free slots. Tappable when onArm is given. */
import type { PowerUp } from './types'
import s from './PowerSlots.module.css'

const SLOTS = 3

export function PowerSlots({ held, armed, onArm }: { held: PowerUp[]; armed: string | null; onArm?: (key: string) => void }) {
  const empties = Math.max(0, SLOTS - held.length)
  return (
    <div className={s.pups}>
      {held.map((p) => {
        const cls = `${s.pu} ${armed === p.key ? s.on : ''}`
        const label = `${p.icon} ${p.name}`
        return onArm
          ? <button key={p.key} type="button" className={cls} aria-pressed={armed === p.key} onClick={() => onArm(p.key)}>{label}</button>
          : <span key={p.key} className={cls} data-armed={armed === p.key}>{label}</span>
      })}
      {Array.from({ length: empties }, (_, i) => <span key={i} className={`${s.pu} ${s.empty}`} data-testid="pu-empty">+</span>)}
    </div>
  )
}
