import { useEffect, useRef, useState } from 'react'
import { useElapsed } from '../useElapsed'
import type { Micro, MicroProps } from '../types'
import s from './microC.module.css'

function ShhGame({ level, rng, onDone }: MicroProps) {
  const fuse = 900 - level * 80
  const [ringing] = useState(() => Math.floor(rng() * 3))
  const done = useRef(false)
  const ms = useElapsed()
  const finish = (ok: boolean) => {
    if (done.current) return
    done.current = true
    onDone(ok)
  }
  useEffect(() => {
    const id = setTimeout(() => finish(false), fuse)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className={s.stage}>
      <div className={s.row}>
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            type="button"
            className={`${s.kb} ${s.clock} ${i === ringing ? s.ring : ''}`}
            aria-label={i === ringing ? 'Alarm clock, ringing' : 'Alarm clock, quiet'}
            onClick={() => finish(i === ringing)}
          >
            {i === ringing ? '⏰' : '🕰️'}
          </button>
        ))}
      </div>
      <div className={s.fuse} aria-hidden="true">
        <div className={s.fuseIn} style={{ width: `${Math.max(0, 100 - (ms / fuse) * 100)}%` }} />
      </div>
    </div>
  )
}

export const shh: Micro = { key: 'shh', name: 'Shh!', cmd: 'SHH!', Component: ShhGame }
