import { useEffect, useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microC.module.css'

function WaterGame({ level, onDone }: MicroProps) {
  const dur = 1400 - level * 120
  const lo = 59 + level
  const hi = 81 - level
  const done = useRef(false)
  const t0 = useRef<number | null>(null)
  const [fill, setFill] = useState(0)
  const finish = (ok: boolean) => {
    if (done.current) return
    done.current = true
    t0.current = null
    onDone(ok)
  }
  const pct = () => (t0.current === null ? 0 : ((Date.now() - t0.current) / dur) * 100)
  const down = () => {
    if (done.current || t0.current !== null) return
    t0.current = Date.now()
  }
  const up = () => {
    if (done.current || t0.current === null) return
    const p = pct()
    finish(p >= lo && p <= hi)
  }
  useEffect(() => {
    const id = setInterval(() => {
      if (done.current || t0.current === null) return
      const p = pct()
      setFill(Math.min(100, p))
      if (p > 100) finish(false)
    }, 16)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const keyOk = (e: React.KeyboardEvent) => e.key === ' ' && !e.repeat
  return (
    <div className={s.stage}>
      <div className={s.waterWrap}>
        <span className={s.plant} aria-hidden="true">{fill > hi ? '🌊' : '🌱'}</span>
        <div className={s.meter} aria-hidden="true">
          <div className={s.band} style={{ bottom: `${lo}%`, height: `${hi - lo}%` }} />
          <div className={s.fill} style={{ height: `${fill}%` }} />
        </div>
      </div>
      <button
        type="button"
        className={`${s.kb} ${s.sun}`}
        aria-label="Hold to water"
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => { if (keyOk(e)) down() }}
        onKeyUp={(e) => { if (e.key === ' ') up() }}
      >
        🪣 Hold, let go in the green
      </button>
    </div>
  )
}

export const water: Micro = { key: 'water', name: 'Water!', cmd: 'WATER!', Component: WaterGame }
