import { useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microD.module.css'

function SpotGame({ level, rng, onDone, easier }: MicroProps) {
  const side = level >= 3 ? 4 : 3
  const cells = side * side - (easier ? 1 : 0)
  const [muddy] = useState(() => Math.floor(rng() * cells))
  const done = useRef(false)
  const pick = (i: number) => {
    if (done.current) return
    done.current = true
    onDone(i === muddy)
  }
  return (
    <div className={s.stage}>
      <div className={`${s.grid} ${side === 4 ? s.g4 : s.g3}`}>
        {Array.from({ length: cells }, (_, i) => (
          <button key={i} type="button" className={s.tile} aria-label={`Footprint ${i + 1}`}
            data-muddy={i === muddy ? '' : undefined} onClick={() => pick(i)}>
            <img src="/art/fluent/dog.webp" alt="dog" width={50} height={50} className={i === muddy ? s.mud : undefined} aria-hidden />
          </button>
        ))}
      </div>
      <p className={s.hint}>Which one is muddy?</p>
    </div>
  )
}

export const spot: Micro = { key: 'spot', name: 'Spot!', cmd: 'SPOT!', Component: SpotGame }
