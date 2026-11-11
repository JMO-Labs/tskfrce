import { useEffect, useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microB.module.css'

const MASCOTS = ['trex', 'lizard-sombrero', 'dog-cowboy', 'axolotl', 'cat-princess', 'sloth-cool']

function DodgeGame({ level, rng, onDone, easier }: MicroProps) {
  const [{ lane, mascot }] = useState(() => ({ lane: Math.floor(rng() * 3), mascot: MASCOTS[Math.floor(rng() * MASCOTS.length)] }))
  const [pos, setPos] = useState(1)
  const posRef = useRef(1)
  const done = useRef(false)
  const move = (d: number) => {
    if (done.current) return
    posRef.current = Math.max(0, Math.min(2, posRef.current + d))
    setPos(posRef.current)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'ArrowRight') move(1)
    }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => {
      if (done.current) return
      done.current = true
      onDone(posRef.current !== lane)
    }, (1200 - level * 100) * (easier ? 1.1 : 1))
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className={s.stage} style={{ display: 'block' }}>
      <div className={s.dodgeBox}>
        <div className={s.road}>
          {[0, 1, 2].map(i => (
            <div key={i} className={s.lane}>
              {i === lane && (<>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={s.mascot} src={`/celebrate/mascots/${mascot}.svg`} alt="Sleeping friend" />
              </>)}
            </div>
          ))}
          <div className={s.vac} style={{ transform: `translateX(${pos * 100}%)` }} aria-hidden>
            <img src="/art/fluent/flag.webp" alt="flag" width={50} height={50} />
          </div>
        </div>
        <div className={s.ctl}>
          <button type="button" className={`${s.kb} ${s.sun}`} aria-label="Left" onClick={() => move(-1)}>◀ Left</button>
          <button type="button" className={`${s.kb} ${s.sun}`} aria-label="Right" onClick={() => move(1)}>Right ▶</button>
        </div>
      </div>
    </div>
  )
}

export const dodge: Micro = { key: 'dodge', name: 'Dodge!', cmd: 'DODGE!', Component: DodgeGame }
