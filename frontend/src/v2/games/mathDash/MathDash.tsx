/** Math Dash: tap the right answer before the clock runs out. Score = correct answers. */
import { useEffect, useRef, useState } from 'react'
import type { AgeGroup } from '../../types'
import { seeded } from '../rng'
import { useElapsed } from '../useElapsed'
import { answerQ, hiddenCount, initMath, limitMs } from './logic'
import { initPixiApp, destroyPixiApp } from '../PixiApp'
import { initGameDisplay, updateQuestion, animateCorrect, animateWrong, updateShake, destroyGameDisplay } from './render'
import type { GameDisplay } from './render'
import { Mascot, type MascotState } from '../Mascot'
import s from './MathDash.module.css'

const PU: Record<string, string> = { freeze: '❄️ Freeze', fifty: '✂️ 50/50' }
const clock = (left: number) => {
  const sec = Math.ceil(Math.max(0, left) / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function MathDash({ level, seed, age, upgrades = [], powerUp = null, onEnd }: {
  level: number; seed: number; age: AgeGroup; upgrades?: string[]; powerUp?: string | null; onEnd: (score: number) => void
}) {
  const [rng] = useState(() => seeded(seed))
  const [st, setSt] = useState(() => initMath(age, level, rng))
  const [mascotState, setMascotState] = useState<MascotState>('idle')
  const mascotReactRef = useRef<NodeJS.Timeout | null>(null)
  const displayRef = useRef<GameDisplay | null>(null)
  const limit = limitMs(upgrades, powerUp)
  const ms = useElapsed()
  const over = ms >= limit
  const ended = useRef(false)
  const gameRef = useRef<HTMLDivElement>(null)
  const animRef = useRef(0)

  // Initialize Pixi app
  useEffect(() => {
    if (!gameRef.current) return

    const setup = async () => {
      const w = gameRef.current!.clientWidth || 400
      const h = gameRef.current!.clientHeight || 500
      const { app, stage } = await initPixiApp(gameRef.current!, w, h)
      const disp = await initGameDisplay(app, stage, w, h)
      displayRef.current = disp

      // Game loop
      const tick = () => {
        updateShake(disp)
        animRef.current = requestAnimationFrame(tick)
      }
      animRef.current = requestAnimationFrame(tick)
    }

    setup()

    return () => {
      if (mascotReactRef.current) clearTimeout(mascotReactRef.current)
      cancelAnimationFrame(animRef.current)
      if (displayRef.current) {
        destroyGameDisplay(displayRef.current)
        destroyPixiApp(displayRef.current.app)
      }
    }
  }, [])

  // Update question display
  useEffect(() => {
    if (!displayRef.current) return
    const hidden = st.q.hide.slice(0, hiddenCount(st.qIdx, upgrades, powerUp))
    updateQuestion(displayRef.current, st.q, hidden)
  }, [st.q, st.qIdx, upgrades, powerUp])

  // Handle end game
  useEffect(() => {
    if (over && !ended.current) { ended.current = true; setMascotState('dance'); onEnd(st.score) }
  }, [over, st.score, onEnd])

  const handleAnswer = (i: number) => {
    const hidden = st.q.hide.slice(0, hiddenCount(st.qIdx, upgrades, powerUp))
    if (hidden.includes(i) || over) return

    const correct = i === st.q.correct
    if (displayRef.current) {
      if (correct) {
        animateCorrect(displayRef.current, i)
        setMascotState('cheer')
      } else {
        animateWrong(displayRef.current, i)
        setMascotState('wince')
      }
    }

    if (mascotReactRef.current) clearTimeout(mascotReactRef.current)
    mascotReactRef.current = setTimeout(() => setMascotState('idle'), correct ? 800 : 600)
    setSt((cur) => answerQ(cur, i, age, upgrades, rng))
  }

  const hidden = st.q.hide.slice(0, hiddenCount(st.qIdx, upgrades, powerUp))

  return (
    <div>
      <div className={s.hud}>
        <span>🧮 {st.score}</span>
        <Mascot state={mascotState} mascotName="dog-cowboy" />
        <span>⏱ {clock(limit - ms)}</span>
      </div>
      <div ref={gameRef} style={{ width: '100%', height: '400px', position: 'relative' }} />

      {/* Test compatibility: off-screen elements for accessibility */}
      <div className={s.testHidden}>
        <div data-testid="q">{st.q.text}</div>
        {st.q.choices.map((c, i) => (
          <button
            key={`${st.qIdx}-${i}`}
            type="button"
            className={`${s.ans} ${hidden.includes(i) ? s.gone : ''}`}
            disabled={over || hidden.includes(i)}
            onClick={() => handleAnswer(i)}
          >{c}</button>
        ))}
        {powerUp && PU[powerUp]
          ? <span className={`${s.pu} ${s.on}`} data-testid="pu-on">{PU[powerUp]}</span>
          : [0, 1].map((i) => <span key={i} className={`${s.pu} ${s.empty}`} data-testid="pu-empty">+</span>)}
      </div>
    </div>
  )
}
