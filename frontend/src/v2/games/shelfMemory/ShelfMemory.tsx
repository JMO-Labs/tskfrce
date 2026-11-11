/** Shelf Memory: study the shelf, then tap an item and tap its slot. 120 s, each round adds an item. */
import { useEffect, useRef, useState } from 'react'
import type { AgeGroup } from '../../types'
import { seeded } from '../rng'
import { useElapsed } from '../useElapsed'
import { PEEK_MS, clockMs, isRight, lookMs, newRound } from './logic'
import { Mascot, type MascotState } from '../Mascot'
import s from './ShelfMemory.module.css'

type Pu = string | { key: string } | null
const PU = { peek: '👀 Peek', lock: '🔒 Lock' } as const
const clock = (ms: number) => {
  const sec = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

interface Props {
  level: number
  seed: number
  age: AgeGroup
  upgrades?: string[]
  powerUp?: Pu
  onEnd: (score: number) => void
  held?: any[]
}

export function ShelfMemory({ level, age, seed, upgrades = [], powerUp = null, onEnd, held = [] }: Props) {
  const [rng] = useState(() => seeded(seed))
  const [round, setRound] = useState(0)
  const [items, setItems] = useState(() => newRound(0, age, upgrades, rng))
  const [placed, setPlaced] = useState<boolean[]>(() => items.map(() => false))
  const [looking, setLooking] = useState(true)
  const [peek, setPeek] = useState(false)
  const [sel, setSel] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [used, setUsed] = useState(false)
  const [score, setScore] = useState(0)
  const [mascotState, setMascotState] = useState<MascotState>('idle')
  const mascotReactRef = useRef<NodeJS.Timeout | null>(null)

  const ms = useElapsed()
  const total = clockMs(upgrades)
  const over = ms >= total
  const ended = useRef(false)
  const endCb = useRef(onEnd)
  const scoreRef = useRef(0)

  useEffect(() => {
    endCb.current = onEnd
  }, [onEnd])

  useEffect(() => {
    if (!looking) return
    const id = setTimeout(() => setLooking(false), lookMs(age, upgrades))
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looking, round])

  useEffect(() => {
    if (!over || ended.current) return
    ended.current = true
    setMascotState('dance')
    endCb.current(scoreRef.current)
  }, [over])

  useEffect(() => {
    return () => {
      if (mascotReactRef.current) clearTimeout(mascotReactRef.current)
    }
  }, [])

  const key = typeof powerUp === 'string' ? powerUp : powerUp?.key
  const puName = key && key in PU ? PU[key as keyof typeof PU] : null
  const show = looking || peek

  const usePeek = () => {
    if (used || looking || over) return
    setUsed(true)
    setPeek(true)
    setTimeout(() => setPeek(false), PEEK_MS)
  }
  const useLock = () => {
    if (!used && !looking && !over) {
      setUsed(true)
      setLocked(true)
    }
  }

  const putSlot = (i: number) => {
    if (over || looking || sel === null || placed[i]) return
    if (!isRight(sel, i, locked)) {
      setMascotState('wince')
      if (mascotReactRef.current) clearTimeout(mascotReactRef.current)
      mascotReactRef.current = setTimeout(() => setMascotState('idle'), 700)
      setSel(null)
      return
    }
    const next = [...placed]
    next[sel] = true
    scoreRef.current += 1
    setScore(scoreRef.current)
    setMascotState('cheer')
    if (mascotReactRef.current) clearTimeout(mascotReactRef.current)
    mascotReactRef.current = setTimeout(() => setMascotState('idle'), 900)
    setLocked(false)
    setSel(null)
    if (next.every(Boolean)) {
      const r = round + 1
      const its = newRound(r, age, upgrades, rng)
      setRound(r)
      setItems(its)
      setPlaced(its.map(() => false))
      setLooking(true)
    } else setPlaced(next)
  }

  return (
    <div>
      <div className={s.hud}>
        <span>🧠 {score}</span>
        <Mascot state={mascotState} mascotName="axolotl" />
        <span>⏱ {clock(total - ms)}</span>
      </div>
      <p className={s.msg}>
        {looking ? 'Look at the shelf!' : peek ? 'Peek!' : locked ? 'Lock ready: place any item' : 'Put each thing back'}
      </p>
      <div className={s.shelf}>
        {items.map((e, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Slot ${i + 1}`}
            className={`${s.slot} ${placed[i] ? s.done : ''}`}
            onClick={() => putSlot(i)}
          >
            {show || placed[i] ? e : ''}
          </button>
        ))}
      </div>
      <div className={s.tray}>
        {!looking &&
          items.map((e, i) =>
            placed[i] ? null : (
              <button
                key={i}
                type="button"
                aria-label={`Item ${e}`}
                aria-pressed={sel === i}
                className={sel === i ? s.sel : ''}
                onClick={() => setSel(sel === i ? null : i)}
              >
                {e}
              </button>
            )
          )}
      </div>
      <div className={s.pups}>
        {puName ? (
          <button
            type="button"
            className={`${s.pu} ${locked ? s.armed : ''}`}
            disabled={used || looking || over}
            onClick={key === 'peek' ? usePeek : useLock}
          >
            {puName}
          </button>
        ) : (
          [0, 1, 2].map((i) => (
            <span key={i} className={`${s.pu} ${s.empty}`} data-testid="pu-empty">
              +
            </span>
          ))
        )}
      </div>
    </div>
  )
}
