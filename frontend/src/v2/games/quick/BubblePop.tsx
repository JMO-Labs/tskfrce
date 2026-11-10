import { useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microA.module.css'

const COLOURS = [
  { name: 'red', c: '#e5383b' },
  { name: 'blue', c: '#3b82f6' },
  { name: 'green', c: '#35b36b' },
  { name: 'yellow', c: '#ffd23c' },
  { name: 'purple', c: '#8b5cf6' },
]

function BubblePopGame({ level, rng, onDone }: MicroProps) {
  const done = useRef(false)
  const [setup] = useState(() => {
    const target = COLOURS[Math.floor(rng() * COLOURS.length)]
    const others = COLOURS.filter((c) => c !== target)
    const want = 2 + (rng() < 0.5 ? 1 : 0)
    const total = 6 + level
    const list = Array.from({ length: total }, (_, i) => (i < want ? target : others[Math.floor(rng() * others.length)]))
    return { target, want, list: list.sort(() => rng() - 0.5) }
  })
  const [popped, setPopped] = useState<Set<number>>(new Set())
  const pop = (i: number) => {
    if (done.current || popped.has(i)) return
    if (setup.list[i] !== setup.target) {
      done.current = true
      onDone(false)
      return
    }
    const next = new Set(popped).add(i)
    setPopped(next)
    if (next.size === setup.want) {
      done.current = true
      onDone(true)
    }
  }
  return (
    <div className={s.stage}>
      <div className={s.word} aria-label={`Pop ${setup.target.name}`}>
        <span className={s.swatch} style={{ background: setup.target.c }} />
        <span aria-hidden="true">{setup.target.name.toUpperCase()}</span>
      </div>
      <div className={s.bubbles}>
        {setup.list.map((c, i) => (
          <button
            key={i}
            type="button"
            className={`${s.bubble} ${popped.has(i) ? s.popped : ''}`}
            style={{ background: c.c }}
            aria-label={`${c.name} bubble`}
            onClick={() => pop(i)}
          />
        ))}
      </div>
    </div>
  )
}

export const bubblePop: Micro = { key: 'bubble-pop', name: 'Bubble Pop', cmd: 'POP!', Component: BubblePopGame }
