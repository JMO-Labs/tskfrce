import { useEffect, useState } from 'react'
import { hhLeft, mmss } from './happyHour'
import type { KidToday } from '../types'

const still = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Compact Happy Hour bar (excitement-v3 .hh). Counts down by itself and hides at 0 without a refetch. */
export function HappyHourBanner({ hh, onGo }: { hh: KidToday['happy_hour']; onGo: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const live = !!hh && hhLeft(hh, now) > 0
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live, hh?.ends_at])
  if (!hh || !live) return null
  return (
    <div className="k-hh" data-testid="hh" data-still={still() || undefined} role="status">
      <div className="k-hh-t">
        <b>HAPPY HOUR!</b>
        <small>{`Every chore is worth ${hh.multiplier}×`}</small>
      </div>
      <span className="k-hh-cd">{mmss(hhLeft(hh, now))}</span>
      <button type="button" className="k-hh-go" onClick={onGo}>
        Go →
      </button>
    </div>
  )
}
