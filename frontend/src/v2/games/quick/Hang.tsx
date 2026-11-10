import { useState } from 'react'
import { useElapsed } from '../useElapsed'
import type { Micro, MicroProps } from '../types'
import s from './microC.module.css'

const swing = (ms: number, level: number) => Math.sin((ms / 1000) * (1.5 + level * 0.4))

function HangGame({ level, onDone }: MicroProps) {
  const [t0] = useState(() => Date.now())
  const [frozen, setFrozen] = useState<number | null>(null)
  const live = useElapsed(frozen === null)
  const x = swing(frozen ?? live, level)
  const drop = () => {
    if (frozen !== null) return
    const t = Date.now() - t0
    setFrozen(t)
    onDone(Math.abs(swing(t, level)) < Math.max(0.13, 0.3 - level * 0.03))
  }
  const left = `${50 + x * 40}%`
  return (
    <div className={s.stage}>
      <div className={s.rack}>
        <div className={s.pole} />
        <div className={s.target} />
        <span className={s.hanger} style={{ left }} aria-hidden="true">
          {frozen !== null ? '🧥' : '👕'}
        </span>
      </div>
      <button type="button" className={`${s.kb} ${s.sun}`} onClick={drop}>
        Drop the shirt
      </button>
    </div>
  )
}

export const hang: Micro = { key: 'hang', name: 'Hang!', cmd: 'HANG!', Component: HangGame }
