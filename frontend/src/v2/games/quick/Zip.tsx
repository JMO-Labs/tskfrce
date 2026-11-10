import { useEffect, useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microB.module.css'

function ZipGame({ level, onDone, easier }: MicroProps) {
  const base = 1 + Math.floor(level / 2)
  const need = easier && base > 1 ? base - 1 : base
  const [ups, setUps] = useState(0)
  const done = useRef(false)
  const count = useRef(0)
  const down = useRef<{ x: number; y: number } | null>(null)
  const go = (dir: 'up' | 'bad') => {
    if (done.current) return
    if (dir === 'bad') { done.current = true; onDone(false); return }
    count.current += 1
    setUps(count.current)
    if (count.current >= need) { done.current = true; onDone(true) }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') go('up')
      else if (e.key.startsWith('Arrow')) go('bad')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need])
  const release = (x: number, y: number) => {
    const d = down.current
    down.current = null
    if (!d) return
    const dx = x - d.x, dy = y - d.y
    if (Math.hypot(dx, dy) < 40) return
    go(Math.abs(dy) >= Math.abs(dx) && dy < 0 ? 'up' : 'bad')
  }
  return (
    <div className={s.stage} data-testid="zip"
      onPointerDown={e => { down.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={e => release(e.clientX, e.clientY)}>
      <div className={s.pack}>
        <div className={s.zipLine} />
        <div className={s.pull} style={{ top: `${120 - (ups / need) * 90}px` }} />
      </div>
      <div className={`${s.ups} ${s.arrow}`} aria-hidden>⬆️ swipe up{need > 1 ? ` ×${need - ups}` : ''}</div>
      <button type="button" className={`${s.kb} ${s.sun}`} onClick={() => go('up')} aria-label="Zip up">Zip up</button>
    </div>
  )
}

export const zip: Micro = { key: 'zip', name: 'Zip!', cmd: 'ZIP!', Component: ZipGame }
