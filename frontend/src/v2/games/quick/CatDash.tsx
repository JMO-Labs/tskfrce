import { useCallback, useEffect, useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microD.module.css'

function CatDashGame({ level, rng, onDone, easier }: MicroProps) {
  const [treat] = useState(() => Math.floor(rng() * 3))
  const [lane, setLane] = useState(1)
  const laneRef = useRef(1)
  const done = useRef(false)
  const fall = (1500 - level * 100) * (easier ? 1.1 : 1)

  const move = useCallback((d: -1 | 1) => {
    if (done.current) return
    laneRef.current = Math.min(2, Math.max(0, laneRef.current + d))
    setLane(laneRef.current)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      if (done.current) return
      done.current = true
      onDone(laneRef.current === treat)
    }, fall)
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'ArrowRight') move(1)
    }
    window.addEventListener('keydown', k)
    return () => { clearTimeout(t); window.removeEventListener('keydown', k) }
  }, [fall, treat, move, onDone])

  return (
    <div className={s.stage}>
      <div className={s.lanes}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={s.lane}>
            {i === treat && <span className={s.treat} data-testid="treat" data-lane={i} style={{ animationDuration: `${fall}ms` }} aria-hidden>🍤</span>}
          </div>
        ))}
        <div className={s.cat} style={{ transform: `translateX(${(lane - 1) * 100}px)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/celebrate/mascots/cat-princess.svg" alt="Princess cat" />
        </div>
      </div>
      <div className={s.row}>
        <button type="button" className={s.kb} aria-label="Left" onClick={() => move(-1)}>⬅️</button>
        <button type="button" className={s.kb} aria-label="Right" onClick={() => move(1)}>➡️</button>
      </div>
    </div>
  )
}

export const catDash: Micro = { key: 'cat-dash', name: 'Hungry Cat dash', cmd: 'SNACK!', Component: CatDashGame }
