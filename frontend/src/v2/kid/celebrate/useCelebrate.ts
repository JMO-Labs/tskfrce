import { useCallback, useEffect, useRef, useState } from 'react'
import type { CelebrateLevel } from '../../types'
import type { KidAge } from '../modes/types'
import { devPreview } from './devPreview'
import type { Combo, Rng } from './pick'
import { planShow, type CelebrateEvent, type Show } from './plan'
import { playSound, soundOn } from './sound'

/** About 1.5 s, the longest a celebration runs (spec 1). */
export const CELEBRATE_MS = 1500

export interface CelebrateOpts {
  level: CelebrateLevel
  mode: KidAge
  kidLevel: number
  /** an award card (badge / level) is up: wait for it */
  hold?: boolean
  rng?: Rng
}

export interface Celebrate {
  show: Show | null
  fire: (e: CelebrateEvent) => void
  dismiss: () => void
  /** dev screenshot hook: animations paused at this many ms */
  freeze: number | null
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The celebration engine: plans each event once, plays one at a time, ends after ~1.5 s or on any tap. */
export function useCelebrate({ level, mode, kidLevel, hold = false, rng = Math.random }: CelebrateOpts): Celebrate {
  const [dev] = useState(() => (typeof window === 'undefined' ? null : devPreview(window.location.search, mode)))
  const [queue, setQueue] = useState<Show[]>([])
  useEffect(() => {
    if (!dev) return
    const t = window.setTimeout(() => setQueue((q) => [...q, dev.show])) // after the tiles are on screen
    return () => window.clearTimeout(t)
  }, [dev])
  const played = useRef(new Set<string>())
  const last = useRef<Combo | null>(null)

  const fire = useCallback(
    (e: CelebrateEvent) => {
      if (played.current.has(e.key)) return
      played.current.add(e.key)
      const s = planShow(e, { level, mode, reduced: reducedMotion(), rng, last: last.current, kidLevel, date: new Date() })
      if (!s) return
      if (s.combo) last.current = s.combo
      if (s.kind !== 'static' && soundOn()) playSound()
      setQueue((q) => [...q, s])
    },
    [level, mode, kidLevel, rng],
  )
  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), [])

  const show = hold ? null : (queue[0] ?? null)
  const frozen = !!dev && show === dev.show && dev.freeze !== null
  useEffect(() => {
    if (!show || frozen) return
    const t = window.setTimeout(dismiss, CELEBRATE_MS)
    // any tap ends it; the tap itself still reaches the app (the layer never takes pointer events)
    window.addEventListener('pointerdown', dismiss, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('pointerdown', dismiss, true)
    }
  }, [show, frozen, dismiss])

  return { show, fire, dismiss, freeze: frozen ? dev!.freeze : null }
}
