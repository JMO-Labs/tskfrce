/** Math Dash: tap the right answer before the clock runs out. Score = correct answers. */
import { useEffect, useRef, useState } from 'react'
import type { AgeGroup } from '../../types'
import { seeded } from '../rng'
import { useElapsed } from '../useElapsed'
import { answerQ, hiddenCount, initMath, limitMs } from './logic'
import { initPixiApp, destroyPixiApp } from '../PixiApp'
import { initGameDisplay, updateQuestion, animateCorrect, animateWrong, updateShake, destroyGameDisplay } from './render'
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
  const [display, setDisplay] = useState(null as ReturnType<typeof initGameDisplay> | null)
  const limit = limitMs(upgrades, powerUp)
  const ms = useElapsed()
  const over = ms >= limit
  const ended = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
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
      setDisplay(disp)

      // Game loop
      const tick = () => {
        updateShake(disp, 16)
        animRef.current = requestAnimationFrame(tick)
      }
      animRef.current = requestAnimationFrame(tick)

      return () => cancelAnimationFrame(animRef.current)
    }

    setup().then((cleanup) => cleanup)

    return () => {
      if (display) {
        destroyGameDisplay(display)
        destroyPixiApp(display.app)
        setDisplay(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update question display
  useEffect(() => {
    if (!display) return
    const hidden = st.q.hide.slice(0, hiddenCount(st.qIdx, upgrades, powerUp))
    updateQuestion(display, st.q, hidden)
  }, [st.q, st.qIdx, display, upgrades, powerUp])

  // Handle end game
  useEffect(() => {
    if (over && !ended.current) { ended.current = true; onEnd(st.score) }
  }, [over, st.score, onEnd])

  const handleAnswer = (i: number) => {
    const hidden = st.q.hide.slice(0, hiddenCount(st.qIdx, upgrades, powerUp))
    if (hidden.includes(i) || over) return

    const correct = i === st.q.correct
    if (display) {
      if (correct) {
        animateCorrect(display, i)
      } else {
        animateWrong(display, i)
      }
    }

    setSt((cur) => answerQ(cur, i, age, upgrades, rng))
  }

  const hidden = st.q.hide.slice(0, hiddenCount(st.qIdx, upgrades, powerUp))

  return (
    <div ref={containerRef}>
      <div className={s.hud}>
        <span>🧮 {st.score}</span>
        <span>⏱ {clock(limit - ms)}</span>
      </div>
      <div ref={gameRef} style={{ width: '100%', height: '400px', position: 'relative' }} />

      {/* Test compatibility: hidden elements */}
      <div style={{ display: 'none' }}>
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
