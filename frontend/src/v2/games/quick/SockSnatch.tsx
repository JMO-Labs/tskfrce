import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microA.module.css'

const COLOURS = [
  { name: 'pink', c: '#e0457b' },
  { name: 'blue', c: '#3b82f6' },
  { name: 'green', c: '#35b36b' },
  { name: 'orange', c: '#ff8a3d' },
  { name: 'purple', c: '#8b5cf6' },
  { name: 'yellow', c: '#ffd23c' },
  { name: 'teal', c: '#14b8a6' },
  { name: 'red', c: '#e5383b' },
]

function Sock({ c, big }: { c: string; big?: boolean }) {
  return (
    <span className={`${s.sock} ${big ? s.sockBig : ''}`} style={{ '--c': c } as CSSProperties} aria-hidden="true">
      <span className={s.cuff} />
    </span>
  )
}

function SockSnatchGame({ level, rng, onDone }: MicroProps) {
  const done = useRef(false)
  const [picks] = useState(() => {
    const pool = [...COLOURS]
    const out: typeof COLOURS = []
    const n = Math.min(3 + level, pool.length)
    for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
    return { target: out[0], list: [...out].sort(() => rng() - 0.5) }
  })
  const pick = (name: string) => {
    if (done.current) return
    done.current = true
    onDone(name === picks.target.name)
  }
  return (
    <div className={s.stage}>
      <div role="img" aria-label={`Target sock: ${picks.target.name}`}>
        <Sock c={picks.target.c} big />
      </div>
      <p className={s.hint}>Find the match</p>
      <div className={`${s.socks} ${picks.list.length > 4 ? s.many : ''}`}>
        {picks.list.map((p) => (
          <button key={p.name} type="button" className={s.tray} aria-label={`${p.name} sock`} onClick={() => pick(p.name)}>
            <Sock c={p.c} />
          </button>
        ))}
      </div>
    </div>
  )
}

export const sockSnatch: Micro = { key: 'sock-snatch', name: 'Sock Snatch', cmd: 'PAIR!', Component: SockSnatchGame }
