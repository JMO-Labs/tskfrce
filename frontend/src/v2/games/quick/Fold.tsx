import { useCallback, useEffect, useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microD.module.css'

const DIRS = ['up', 'down', 'left', 'right'] as const
type Dir = (typeof DIRS)[number]
const GLYPH: Record<Dir, string> = { up: '⬆️', down: '⬇️', left: '⬅️', right: '➡️' }
const label = (d: Dir) => d[0].toUpperCase() + d.slice(1)

function FoldGame({ level, rng, onDone, easier }: MicroProps) {
  const [seq] = useState<Dir[]>(() => Array.from({ length: Math.max(2, 2 + Math.floor(level / 2) - (easier ? 1 : 0)) }, () => DIRS[Math.floor(rng() * 4)]))
  const [at, setAt] = useState(0)
  const pos = useRef(0)
  const done = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  const press = useCallback((d: Dir) => {
    if (done.current) return
    if (d !== seq[pos.current]) { done.current = true; onDone(false); return }
    pos.current += 1
    setAt(pos.current)
    if (pos.current === seq.length) { done.current = true; onDone(true) }
  }, [seq, onDone])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const m = /^Arrow(Up|Down|Left|Right)$/.exec(e.key)
      if (m) { e.preventDefault(); press(m[1].toLowerCase() as Dir) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [press])

  const up = (e: React.PointerEvent) => {
    const a = start.current
    start.current = null
    if (!a) return
    const dx = e.clientX - a.x, dy = e.clientY - a.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return
    press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }

  return (
    <div className={s.stage} onPointerDown={(e) => { start.current = { x: e.clientX, y: e.clientY } }} onPointerUp={up}>
      <div className={s.towel} aria-label="Folds to do">
        {seq.map((d, i) => (
          <span key={i} data-testid="fold-step" data-dir={d}
            className={`${s.step} ${i < at ? s.stepDone : i === at ? s.stepNow : ''}`}>{GLYPH[d]}</span>
        ))}
      </div>
      <p className={s.hint}>Swipe them in order</p>
      <div className={s.pad}>
        {DIRS.map((d) => (
          <button key={d} type="button" className={`${s.kb} ${s[d]}`} aria-label={label(d)} onClick={() => press(d)}>{GLYPH[d]}</button>
        ))}
      </div>
    </div>
  )
}

export const fold: Micro = { key: 'fold', name: 'Fold!', cmd: 'FOLD!', Component: FoldGame }
