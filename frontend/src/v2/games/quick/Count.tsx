import { useEffect, useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microD.module.css'

/** three distinct answers (>=1) that include `n`, shuffled by rng */
const choices = (n: number, rng: () => number) => {
  const set = new Set([n])
  while (set.size < 3) {
    const c = n + (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 2))
    if (c >= 1) set.add(c)
  }
  return [...set].sort((a, b) => a - b)
}

function CountGame({ level, rng, onDone }: MicroProps) {
  const [n] = useState(() => 3 + Math.floor(rng() * (2 + level)))
  const [opts] = useState(() => choices(n, rng))
  const [shown, setShown] = useState(true)
  const done = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(false), 1100 - level * 120)
    return () => clearTimeout(t)
  }, [level])
  const pick = (v: number) => {
    if (done.current) return
    done.current = true
    onDone(v === n)
  }
  return (
    <div className={s.stage}>
      <div className={`${s.cookies} ${shown ? '' : s.hidden}`}>
        {shown ? Array.from({ length: n }, (_, i) => <span key={i} className={s.cookie} data-testid="cookie">🍪</span>) : <span aria-hidden>🫙</span>}
      </div>
      <p className={s.hint}>{shown ? 'Count the cookies!' : 'How many were there?'}</p>
      <div className={s.row}>
        {opts.map((v) => (
          <button key={v} type="button" className={`${s.kb} ${s.sun} ${s.num}`} onClick={() => pick(v)}>{v}</button>
        ))}
      </div>
    </div>
  )
}

export const count: Micro = { key: 'count', name: 'Count!', cmd: 'COUNT!', Component: CountGame }
