import { useEffect, useRef, useState } from 'react'
import { useElapsed } from '../useElapsed'
import type { Micro, MicroProps } from '../types'
import s from './microC.module.css'

const H = 200

function CatchGame({ level, onDone }: MicroProps) {
  const dur = 1200 - level * 100
  const win = 180 - level * 20
  const [t0] = useState(() => Date.now())
  const done = useRef(false)
  const ms = useElapsed()
  const finish = (ok: boolean) => {
    if (done.current) return
    done.current = true
    onDone(ok)
  }
  useEffect(() => {
    const id = setTimeout(() => finish(false), dur)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const u = Math.min(1, ms / dur)
  const top = H - 4 * u * (1 - u) * H
  return (
    <div className={s.stage}>
      <div className={s.sky} aria-hidden="true">
        <span className={s.key} style={{ top: `${top}px` }}>🔑</span>
        <div className={s.ground} />
      </div>
      <button
        type="button"
        className={`${s.kb} ${s.sun}`}
        aria-label="Catch the keys at the top"
        onClick={() => finish(Math.abs(Date.now() - t0 - dur / 2) <= win)}
      >
        Catch at the top!
      </button>
    </div>
  )
}

export const catchKeys: Micro = { key: 'catch', name: 'Catch!', cmd: 'CATCH!', Component: CatchGame }
