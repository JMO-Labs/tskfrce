import { useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microC.module.css'

const NAMES = ['small', 'medium', 'large']

function MatchGame({ level, rng, onDone }: MicroProps) {
  const [{ pot, lids }] = useState(() => {
    const order = [0, 1, 2]
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    return { pot: Math.floor(rng() * 3), lids: order }
  })
  const done = useRef(false)
  const step = Math.max(24, 36 - level * 4)
  const w = (size: number) => 60 + size * step
  const pick = (size: number) => {
    if (done.current) return
    done.current = true
    onDone(size === pot)
  }
  return (
    <div className={s.stage}>
      <div className={s.pot} data-testid="pot" data-size={pot} aria-label="Pot">
        <div className={s.potBody} style={{ width: w(pot) }}>🍲</div>
      </div>
      <div className={s.row}>
        {lids.map((size) => (
          <button
            key={size}
            type="button"
            data-size={size}
            className={`${s.kb} ${s.lid}`}
            style={{ width: w(size) }}
            aria-label={`${NAMES[size]} lid`}
            onClick={() => pick(size)}
          >
            ●
          </button>
        ))}
      </div>
    </div>
  )
}

export const match: Micro = { key: 'match', name: 'Match!', cmd: 'LID!', Component: MatchGame }
