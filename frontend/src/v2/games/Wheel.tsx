import { useEffect, useState } from 'react'
import type { CelebrateLevel } from '../types'
import { decor, mascotSrc } from './art'
import { gameName } from './catalog'
import s from './wheel.module.css'

export const SPIN_MS = 4000
/** Rotation that leaves slot `slot` (60 degrees each) under the top pointer. */
export const wheelTurn = (slot: number) => 1440 + (360 - (slot * 60 + 30))

/** Mascot wheel: SPIN! lands on `slot`, then `onDone` after a short beat. Reduced decor skips the spin. */
export function Wheel({ slots, slot, celebrate, seed, onDone }: { slots: string[]; slot: number; celebrate: CelebrateLevel; seed: number; onDone: () => void }) {
  const mode = decor(celebrate)
  const [turn, setTurn] = useState<number | null>(null)
  useEffect(() => {
    if (turn === null) return
    const t = setTimeout(onDone, (mode === 'off' ? 0 : mode === 'small' ? 2000 : SPIN_MS) + 600)
    return () => clearTimeout(t)
  }, [turn]) // eslint-disable-line react-hooks/exhaustive-deps
  const ms = mode === 'small' ? 2000 : SPIN_MS
  return (
    <div className={s.root} data-decor={mode}>
      <div className={s.enter}>
        <img className={s.host} src={mascotSrc(seed)} alt="" />
        <div className={s.bubble}>Spin to pick your game!</div>
      </div>
      <div className={s.wrap}>
        <div className={s.pointer} aria-hidden="true">▼</div>
        <div
          className={s.wheel}
          data-testid="wheel"
          style={{ transform: `rotate(${turn ?? 0}deg)`, transition: turn !== null && mode !== 'off' ? `transform ${ms}ms cubic-bezier(.15,.8,.2,1)` : 'none' }}
        >
          {slots.map((g, i) => (
            <span key={i} style={{ ['--i' as string]: i }}>{gameName(g)}</span>
          ))}
        </div>
      </div>
      <button type="button" className={s.go} disabled={turn !== null} onClick={() => setTurn(wheelTurn(slot))}>SPIN!</button>
    </div>
  )
}
