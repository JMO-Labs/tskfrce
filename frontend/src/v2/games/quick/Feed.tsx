import { useEffect, useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microD.module.css'

function FeedGame({ onDone }: MicroProps) {
  const taps = useRef(0)
  const done = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const [n, setN] = useState(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  const tap = () => {
    if (done.current) return
    taps.current += 1
    setN(taps.current)
    if (taps.current === 1) {
      timer.current = setTimeout(() => { done.current = true; onDone(true) }, 700)
    } else {
      clearTimeout(timer.current)
      done.current = true
      onDone(false)
    }
  }

  return (
    <div className={s.stage}>
      <button type="button" className={`${s.bowl} ${n ? s.fed : ''}`} aria-label="Fish bowl, tap once" onClick={tap}>
        <span aria-hidden>🐟</span>
        {n > 0 && <span className={s.flake} aria-hidden>✨</span>}
      </button>
      <p className={s.hint}>Just once!</p>
    </div>
  )
}

export const feed: Micro = { key: 'feed', name: 'Feed!', cmd: 'FEED!', Component: FeedGame }
