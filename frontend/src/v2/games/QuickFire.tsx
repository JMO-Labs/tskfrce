/** Quick-fire runner: one microgame at a time, ~60 s, 3 hearts. The runner owns the countdown and records one part per game. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgeGroup } from '../types'
import type { GamePart, Micro } from './types'
import { MICROS } from './quick'
import { seeded } from './rng'
import { RUN_MS, microLevel, partScore } from './scoring'
import { runHearts, runLevel, runWindow } from './quickRun'
import s from './QuickFire.module.css'

interface Props { age: AgeGroup; startLevel: number; seed: number; onEnd: (parts: GamePart[]) => void; micros?: Micro[]; upgrades?: string[]; powerUp?: string | null; microUpgrades?: Record<string, string[]> }

export function QuickFire({ age, startLevel, seed, onEnd, micros = MICROS, upgrades = [], powerUp = null, microUpgrades = {} }: Props) {
  const order = useMemo(() => {
    const a = [...micros]
    const r = seeded(seed)
    for (let k = a.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1))
      ;[a[k], a[j]] = [a[j], a[k]]
    }
    return a
  }, [micros, seed])
  const [i, setI] = useState(0)
  const maxHearts = runHearts(upgrades, powerUp)
  const [hearts, setHearts] = useState(maxHearts)
  const [score, setScore] = useState(0)
  const [flash, setFlash] = useState<boolean | null>(null)
  const [fast, setFast] = useState(false)
  // mutable run state: one part per game, onEnd once
  const runRef = useRef({ parts: [] as GamePart[], live: true, ended: false, hearts: maxHearts, t0: 0, i: 0 })
  const onEndRef = useRef(onEnd)
  useEffect(() => { onEndRef.current = onEnd })

  const finish = () => {
    const run = runRef.current
    if (run.ended) return
    run.ended = true
    run.live = false
    onEndRef.current(run.parts)
  }

  const micro = order[i % Math.max(order.length, 1)]
  const fx = { upgrades, powerUp, micro: (micro && microUpgrades[micro.key]) || [] }
  const level = runLevel(startLevel, i, order.length, fx)
  const win = runWindow(age, i, fx)

  const record = (ok: boolean) => {
    const run = runRef.current
    if (!run.live || run.ended || !micro) return
    run.live = false
    const part = { game: micro.key, ok, ms: Math.min(Date.now() - run.t0, win) }
    run.parts.push(part)
    if (ok) setScore((v) => v + partScore(part.ms))
    else run.hearts -= 1
    setHearts(run.hearts)
    setFlash(ok)
    if (run.hearts <= 0) return finish()
    setTimeout(() => {
      if (run.ended) return
      const n = run.i + 1
      run.i = n
      run.live = true
      const rose = microLevel(startLevel, n) > microLevel(startLevel, n - 1)
      setFlash(null)
      setI(n)
      setFast(rose)
      if (rose) setTimeout(() => setFast(false), 1200)
    }, 400)
  }
  const recordRef = useRef(record)
  useEffect(() => { recordRef.current = record })

  useEffect(() => {
    const id = setTimeout(finish, RUN_MS)
    return () => clearTimeout(id)
  }, [])

  // per-game countdown
  useEffect(() => {
    runRef.current.t0 = Date.now()
    const id = setTimeout(() => recordRef.current(false), win)
    return () => clearTimeout(id)
  }, [i, win])

  if (!micro) return null
  const C = micro.Component
  return (
    <div className={s.root}>
      <div className={s.hud}>
        <span aria-label={`${hearts} hearts left`}>
          {Array.from({ length: maxHearts }, (_, k) => <span key={k} className={k >= hearts ? s.lost : undefined}>❤️</span>)}
        </span>
        <span>Game {i + 1} · ⭐ {score}</span>
      </div>
      {fast && <div className={s.speed}>FASTER!</div>}
      <div className={s.cmd}>{micro.cmd}</div>
      <div className={s.stage}>
        {flash === null ? <C key={i} level={level} easier={fx.micro.includes('steady')} rng={seeded(seed + i)} onDone={(ok) => recordRef.current(ok)} /> : <div className={s.flash} role="img" aria-label={flash ? 'Yes' : 'Missed'}>{flash ? '✓' : '✗'}</div>}
      </div>
      <div className={s.timer}><i key={i} style={{ animationDuration: `${win}ms` }} /></div>
    </div>
  )
}
