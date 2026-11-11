import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microA.module.css'

type Dir = 'up' | 'down' | 'left' | 'right'
const DIRS: Dir[] = ['up', 'down', 'left', 'right']
const GLYPH: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' }
const KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }
const MIN = 40
const MIN_EASY = 36

function SweepSwipeGame({ level, rng, onDone, easier }: MicroProps) {
  const done = useRef(false)
  const start = useRef<[number, number] | null>(null)
  const [dir] = useState<Dir>(() => DIRS[Math.floor(rng() * 4)])
  const opposite = level >= 4
  const want = opposite ? OPP[dir] : dir
  const answer = (d: Dir) => {
    if (done.current) return
    done.current = true
    onDone(d === want)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const d = KEYS[e.key]
      if (!d) return
      e.preventDefault()
      if (done.current) return
      done.current = true
      onDone(d === want)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [want, onDone])
  const down = (e: PointerEvent) => { start.current = [e.clientX, e.clientY] }
  const up = (e: PointerEvent) => {
    if (!start.current) return
    const dx = e.clientX - start.current[0]
    const dy = e.clientY - start.current[1]
    start.current = null
    if (Math.max(Math.abs(dx), Math.abs(dy)) < (easier ? MIN_EASY : MIN)) return
    answer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }
  return (
    <div className={s.stage} data-testid="sweep-stage" onPointerDown={down} onPointerUp={up}>
      <div className={s.arrow} data-testid="sweep-arrow" data-dir={dir} aria-label={`Arrow ${dir}`} role="img">{GLYPH[dir]}</div>
      {opposite && <p className={s.opp}>opposite!</p>}
      <div className={s.pad}>
        {DIRS.map((d) => (
          <button key={d} type="button" className={s.padBtn} aria-label={`Swipe ${d}`} onClick={() => answer(d)}>{GLYPH[d]}</button>
        ))}
      </div>
    </div>
  )
}

export const sweepSwipe: Micro = { key: 'sweep-swipe', name: 'Sweep Swipe', cmd: 'SWEEP!', Component: SweepSwipeGame }
