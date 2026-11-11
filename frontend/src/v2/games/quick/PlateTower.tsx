import { useRef } from 'react'
import type { Micro, MicroProps } from '../types'
import { useElapsed } from '../useElapsed'
import s from './microA.module.css'
import { Emo } from '../Emo';

function PlateTowerGame({ level, onDone, easier }: MicroProps) {
  const t = useElapsed()
  const done = useRef(false)
  const x = Math.sin((t / 1000) * (1.5 + level * 0.4))
  const tol = Math.max(0.13, 0.25 - level * 0.03) * (easier ? 1.1 : 1)
  const drop = () => {
    if (done.current) return
    done.current = true
    onDone(Math.abs(x) < tol)
  }
  return (
    <div className={`${s.stage} ${s.plateStage}`}>
      <div className={s.rail} aria-hidden="true">
        <span className={s.slider} style={{ left: `${50 + x * 38}%` }}><Emo e="🍽️" /></span>
      </div>
      <div className={s.stack} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <span key={i} className={s.plate} />)}
      </div>
      <button type="button" className={s.tray} style={{ width: 'calc(100% - 32px)', minHeight: 64 }} aria-label="Drop plate" onClick={drop}>
        <span className={s.hint}>Tap when it is over the stack</span>
      </button>
    </div>
  )
}

export const plateTower: Micro = { key: 'plate-tower', name: 'Plate Tower', cmd: 'DROP!', Component: PlateTowerGame }
