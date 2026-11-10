import { useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microB.module.css'

function SqueezeGame({ level, onDone }: MicroProps) {
  const need = 6 + level * 2
  const [n, setN] = useState(0)
  const done = useRef(false)
  const tap = () => {
    if (done.current) return
    const next = n + 1
    setN(next)
    if (next >= need) { done.current = true; onDone(true) }
  }
  return (
    <div className={s.stage}>
      <div className={s.brush} aria-hidden>🪥</div>
      <div className={s.col}>
        <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={Math.min(n, need)}><i style={{ width: `${Math.min(100, (n / need) * 100)}%` }} /></div>
        <button type="button" className={`${s.kb} ${s.sun} ${s.big}`} aria-label="Squeeze the tube" onClick={tap}>
          <span className={s.tube} aria-hidden>🧴</span>
        </button>
      </div>
    </div>
  )
}

export const squeeze: Micro = { key: 'squeeze', name: 'Squeeze!', cmd: 'SQUEEZE!', Component: SqueezeGame }
