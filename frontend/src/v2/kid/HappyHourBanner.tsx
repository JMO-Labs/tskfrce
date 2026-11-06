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
  const left = hhLeft(hh, now)
  const mins = Math.ceil(left / 60)
  return (
    <div className="k-hh" data-testid="hh" data-still={still() || undefined}>
      {/* the live region changes once a minute; the ticking clock is hidden from screen readers */}
      <span className="k-sr" role="status">{`Happy Hour: every chore is worth ${hh.multiplier}×, ${mins} ${mins === 1 ? 'minute' : 'minutes'} left`}</span>
      <div className="k-hh-t">
        <b>HAPPY HOUR!</b>
        <small>{`Every chore is worth ${hh.multiplier}×`}</small>
      </div>
      <span className="k-hh-cd" aria-hidden="true">
        {mmss(left)}
      </span>
      <button type="button" className="k-hh-go" onClick={onGo}>
        Go →
      </button>
    </div>
  )
}
