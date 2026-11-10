/** Pack the Box: tap a piece, tap a cell to place it, fill the box. 120 s. */
import { useEffect, useRef, useState } from 'react'
import type { AgeGroup } from '../../types'
import { seeded } from '../rng'
import { useElapsed } from '../useElapsed'
import { BOX_MS, EXTRA_MS, isFull, lift, newGame, place, prefill, rotate, shapeOf, shrink, undo, type Game, type Piece } from './logic'
import s from './PackBox.module.css'

const POWER: Record<string, { icon: string; name: string }> = { undo: { icon: '↩️', name: 'Undo' }, shrink: { icon: '🔽', name: 'Shrink' } }
const hue = (id: number) => (id * 67 + 20) % 360
const clock = (ms: number) => {
  const sec = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export interface PackBoxProps {
  level: number
  seed: number
  age: AgeGroup
  upgrades?: string[]
  powerUp?: string | null
  onEnd: (score: number) => void
}

export function PackBox({ level, seed, age, upgrades = [], powerUp = null, onEnd }: PackBoxProps) {
  const [rng] = useState(() => seeded(seed))
  const deal = (n: number) => {
    const g = newGame(age, Math.max(0, level - 1) + n, rng)
    return n === 0 && upgrades.includes('rotate_free') ? prefill(g) : g
  }
  const [score, setScore] = useState(0)
  const [g, setG] = useState<Game>(() => deal(0))
  const [sel, setSel] = useState<number | null>(null)
  const [pu, setPu] = useState(powerUp)
  const total = BOX_MS + (upgrades.includes('extra_time') ? EXTRA_MS : 0)
  const ms = useElapsed()
  const over = ms >= total
  const ended = useRef(false)
  const endCb = useRef(onEnd)
  useEffect(() => { endCb.current = onEnd })
  useEffect(() => {
    if (over && !ended.current) { ended.current = true; endCb.current(score) }
  }, [over, score])

  const open = g.pieces.filter((p) => !g.cover.includes(p.id))
  const queue = open.slice(0, 3)
  const next = upgrades.includes('preview') ? open[3] : undefined

  const apply = (ng: Game) => {
    if (isFull(ng)) { setScore((n) => n + 1); setG(deal(score + 1)); setSel(null) } else setG(ng)
  }
  const tapCell = (i: number) => {
    if (over) return
    const v = g.cover[i]
    if (v >= 0) { setG(lift(g, v)); setSel(v); return }
    if (sel === null) return
    const ng = place(g, sel, Math.floor(i / g.w), i % g.w)
    if (ng !== g) { setSel(null); apply(ng) }
  }
  const tapPiece = (id: number) => (sel === id ? setG(rotate(g, id)) : setSel(id))
  const usePu = () => {
    if (!pu || over) return
    apply(pu === 'undo' ? undo(g, 3) : shrink(g))
    setPu(null); setSel(null)
  }

  const mini = (p: Piece, dim = false) => {
    const sh = shapeOf(p)
    const rows = Math.max(...sh.map((c) => c[0])) + 1, cols = Math.max(...sh.map((c) => c[1])) + 1
    return (
      <span className={s.mini} style={{ gridTemplateColumns: `repeat(${cols}, 14px)`, gridTemplateRows: `repeat(${rows}, 14px)`, opacity: dim ? 0.45 : 1 }}>
        {sh.map(([r, c]) => <i key={`${r}-${c}`} style={{ gridRow: r + 1, gridColumn: c + 1, background: `hsl(${hue(p.id)} 70% 60%)` }} />)}
      </span>
    )
  }

  return (
    <div>
      <div className={s.hud}>
        <span>📦 {score}</span>
        <span>⏱ {clock(total - ms)}</span>
      </div>
      <div className={s.box} style={{ gridTemplateColumns: `repeat(${g.w}, var(--cell))`, ['--cols' as string]: g.w }}>
        {g.cover.map((v, i) => (
          <button
            key={i}
            type="button"
            data-testid="cell"
            data-filled={v >= 0 || v === -2 ? '1' : '0'}
            aria-label={v === -2 ? 'filled' : v >= 0 ? 'lift piece' : 'empty cell'}
            disabled={v === -2}
            className={`${s.cell} ${v === -2 ? s.block : ''}`}
            style={v >= 0 ? { background: `hsl(${hue(v)} 70% 60%)` } : undefined}
            onClick={() => tapCell(i)}
          />
        ))}
      </div>
      <div className={s.tray}>
        {queue.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid="piece"
            data-id={p.id}
            aria-label={`Piece of ${p.cells.length}`}
            aria-pressed={sel === p.id}
            className={`${s.piece} ${sel === p.id ? s.sel : ''}`}
            onClick={() => tapPiece(p.id)}
          >{mini(p)}</button>
        ))}
        {next && <span className={s.piece} data-testid="next" aria-label="Next piece">{mini(next, true)}</span>}
        <button type="button" className={s.rot} aria-label="Rotate piece" disabled={sel === null} onClick={() => sel !== null && setG(rotate(g, sel))}>🔄</button>
      </div>
      <div className={s.pups}>
        {[0, 1, 2].map((i) => i === 0 && pu && POWER[pu]
          ? <button key={i} type="button" className={s.pu} aria-label={POWER[pu].name} onClick={usePu}>{POWER[pu].icon} {POWER[pu].name}</button>
          : <span key={i} className={`${s.pu} ${s.empty}`} data-testid="pu-empty">+</span>)}
      </div>
    </div>
  )
}
