/** Hungry Cat: slide the cat, catch food in the bowl, dodge socks. 60 s, 3 hearts. */
import { useEffect, useRef, useState } from 'react'
import { seeded } from '../rng'
import { CAT_MS, initCat, stepCat } from './logic'
import s from './HungryCat.module.css'

const clamp = (n: number) => Math.min(1, Math.max(0, n))
const clock = (ms: number) => {
  const sec = Math.ceil(Math.max(0, CAT_MS - ms) / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function HungryCat({ level, seed, onEnd }: { level: number; seed: number; onEnd: (score: number) => void }) {
  const [rng] = useState(() => seeded(seed))
  const [st, setSt] = useState(() => initCat(level, rng))
  const catX = useRef(0.5)
  const field = useRef<HTMLDivElement>(null)
  const ended = useRef(false)
  const endCb = useRef(onEnd)
  useEffect(() => { endCb.current = onEnd })

  useEffect(() => {
    let raf = 0
    let last = Date.now()
    let cur = st
    const tick = () => {
      const now = Date.now()
      cur = stepCat(cur, Math.min(50, now - last), catX.current, level, rng)
      last = now
      setSt(cur)
      if (cur.over) {
        if (!ended.current) { ended.current = true; endCb.current(cur.score) }
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') catX.current = clamp(catX.current - 0.08)
      else if (e.key === 'ArrowRight') catX.current = clamp(catX.current + 0.08)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const point = (e: React.PointerEvent) => {
    const r = field.current?.getBoundingClientRect()
    if (r && r.width > 0) catX.current = clamp((e.clientX - r.left) / r.width)
  }

  return (
    <div>
      <div className={s.hud}>
        <span>🍽️ {st.score}</span>
        <span aria-label={`${st.hearts} hearts`} role="img">{'❤️'.repeat(Math.max(0, st.hearts))}{'🖤'.repeat(3 - Math.max(0, st.hearts))}</span>
        <span>⏱ {clock(st.t)}</span>
      </div>
      <div
        ref={field}
        className={s.field}
        onPointerDown={(e) => { point(e); e.currentTarget.setPointerCapture?.(e.pointerId) }}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') point(e) }}
      >
        {st.items.map((it) => (
          <span key={it.id} className={s.item} style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%` }}>{it.emoji}</span>
        ))}
        <div className={s.cat} data-testid="cat" style={{ left: `${Math.round(st.catX * 100)}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.catimg} src="/celebrate/mascots/cat-princess.svg" alt="" />
          <div className={s.bowl}>🥣</div>
        </div>
      </div>
      <div className={s.pups}>
        {[0, 1, 2].map((i) => <span key={i} className={`${s.pu} ${s.empty}`} data-testid="pu-empty">+</span>)}
      </div>
    </div>
  )
}
