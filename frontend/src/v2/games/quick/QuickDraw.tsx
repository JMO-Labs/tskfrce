import { useEffect, useRef, useState } from 'react'
import type { Micro, MicroProps } from '../types'
import s from './microA.module.css'

type Phase = 'wait' | 'fake' | 'now'
const LABEL: Record<Phase, string> = { wait: 'Wait…', fake: 'NOT YET', now: 'NOW!' }

function QuickDrawGame({ level, rng, onDone, easier }: MicroProps) {
  const done = useRef(false)
  const [phase, setPhase] = useState<Phase>('wait')
  const [delay] = useState(() => Math.round((500 + Math.floor(rng() * 900)) * (easier ? 0.9 : 1)))
  useEffect(() => {
    const ids = [setTimeout(() => setPhase('now'), delay)]
    if (level >= 3) {
      const at = Math.floor(delay * 0.3)
      ids.push(setTimeout(() => setPhase('fake'), at), setTimeout(() => setPhase('wait'), at + 250))
    }
    return () => ids.forEach(clearTimeout)
  }, [delay, level])
  const tap = () => {
    if (done.current) return
    done.current = true
    onDone(phase === 'now')
  }
  return (
    <div className={s.stage}>
      <button type="button" className={s.draw} data-state={phase} onClick={tap}>{LABEL[phase]}</button>
    </div>
  )
}

export const quickDraw: Micro = { key: 'quick-draw', name: 'Quick Draw', cmd: 'DRAW!', Component: QuickDrawGame }
