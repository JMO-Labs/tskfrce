/** Math Dash: tap the right answer before the clock runs out. Score = correct answers. */
import { useEffect, useRef, useState } from 'react'
import type { AgeGroup } from '../../types'
import { seeded } from '../rng'
import { useElapsed } from '../useElapsed'
import { answerQ, hiddenCount, initMath, limitMs } from './logic'
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
  const limit = limitMs(upgrades, powerUp)
  const ms = useElapsed()
  const over = ms >= limit
  const ended = useRef(false)
  useEffect(() => {
    if (over && !ended.current) { ended.current = true; onEnd(st.score) }
  }, [over, st.score, onEnd])

  const hidden = st.q.hide.slice(0, hiddenCount(st.qIdx, upgrades, powerUp))
  return (
    <div>
      <div className={s.hud}>
        <span>🧮 {st.score}</span>
        <span>⏱ {clock(limit - ms)}</span>
      </div>
      <div className={s.card}>
        <div className={s.q} data-testid="q">{st.q.text}</div>
        <div className={s.streak}>{st.streak >= 2 ? `🔥 ${st.streak} in a row` : ''}</div>
      </div>
      <div className={s.grid}>
        {st.q.choices.map((c, i) => (
          <button
            key={`${st.qIdx}-${i}`}
            type="button"
            className={`${s.ans} ${hidden.includes(i) ? s.gone : ''}`}
            disabled={over || hidden.includes(i)}
            onClick={() => setSt((cur) => answerQ(cur, i, age, upgrades, rng))}
          >{c}</button>
        ))}
      </div>
      <div className={s.pups}>
        {powerUp && PU[powerUp]
          ? <span className={`${s.pu} ${s.on}`} data-testid="pu-on">{PU[powerUp]}</span>
          : [0, 1].map((i) => <span key={i} className={`${s.pu} ${s.empty}`} data-testid="pu-empty">+</span>)}
      </div>
    </div>
  )
}
