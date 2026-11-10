import { useRef, useState } from 'react'
import { useElapsed } from '../useElapsed'
import type { Micro, MicroProps } from '../types'
import s from './microB.module.css'

function FlipGame({ level, rng, onDone }: MicroProps) {
  const [start] = useState(() => 600 + Math.floor(rng() * 700))
  const ms = useElapsed()
  const [flipped, setFlipped] = useState(false)
  const done = useRef(false)
  const hot = ms >= start && ms <= start + (500 - level * 50)
  const tap = () => {
    if (done.current) return
    done.current = true
    setFlipped(true)
    onDone(hot)
  }
  return (
    <div className={s.stage}>
      <button type="button" className={s.panWrap} aria-label="Flip the pancake" data-hot={hot ? '1' : '0'} onClick={tap}>
        <div className={s.pan} />
        <div className={`${s.cake} ${flipped ? s.flipped : ''}`}>🥞</div>
      </button>
      <div className={s.hint}>{hot ? 'NOW!' : 'Wait for the sizzle…'}</div>
    </div>
  )
}

export const flip: Micro = { key: 'flip', name: 'Flip!', cmd: 'FLIP!', Component: FlipGame }
