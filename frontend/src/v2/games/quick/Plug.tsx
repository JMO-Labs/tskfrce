import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microB.module.css'

const SHAPES = ['▲', '●', '■', '◆']
const NAMES: Record<string, string> = { '▲': 'triangle', '●': 'circle', '■': 'square', '◆': 'diamond' }

function PlugGame({ rng, onDone }: MicroProps) {
  const [{ target, sockets }] = useState(() => {
    const pool = [...SHAPES]
    const picks: string[] = []
    for (let i = 0; i < 3; i++) picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
    return { target: picks[Math.floor(rng() * 3)], sockets: picks }
  })
  const done = useRef(false)
  const pick = (shape: string) => {
    if (done.current) return
    done.current = true
    onDone(shape === target)
  }
  const drop = (e: PointerEvent) => {
    const el = document.elementFromPoint?.(e.clientX, e.clientY)?.closest('[data-shape]')
    if (el && el !== e.currentTarget) pick(el.getAttribute('data-shape') ?? '')
  }
  return (
    <div className={s.stage}>
      <div className={s.plugBox}>
        <div className={s.plug} data-testid="plug" data-shape={target} onPointerUp={drop} aria-label={`Plug shape: ${NAMES[target]}`} role="img">{target}</div>
        <div className={s.sockets}>
          {sockets.map(sh => (
            <button key={sh} type="button" className={s.socket} data-shape={sh} aria-label={`${NAMES[sh]} socket`} onClick={() => pick(sh)}>{sh}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

export const plug: Micro = { key: 'plug', name: 'Plug!', cmd: 'PLUG!', Component: PlugGame }
