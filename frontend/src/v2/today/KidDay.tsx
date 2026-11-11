import { useState, type PointerEvent } from 'react'
import { Icon } from '../parent/Icon'
import type { TodayKid } from '../types'
import { DAY_END, DAY_START, frac, hm, minuteOfDay, pct } from './dayTime'
import { useClock, useNow } from './useClock'
import { useFamily } from '../hooks/useFamily'

const R_OUT = 27
const R_IN = 18
const arc = (r: number, f: number) => {
  const c = 2 * Math.PI * r
  return { track: { r }, fill: { r, strokeDasharray: `${Math.max(0.01, c * f)} ${c}` } }
}

function Arc({ r, f, cls, w }: { r: number; f: number; cls: string; w: number }) {
  const a = arc(r, f)
  return (
    <>
      <circle className="pt-arc-t" cx="32" cy="32" r={a.track.r} fill="none" strokeWidth={w} />
      <circle className={cls} cx="32" cy="32" r={a.fill.r} fill="none" strokeWidth={w} strokeLinecap="round" strokeDasharray={a.fill.strokeDasharray} transform="rotate(-90 32 32)" />
    </>
  )
}

const LOCK_TEXT = { hours: 'Hours', chores: 'Chores', manual: 'Manual' } as const

/** Lock pill: "Open", or a lock glyph with why (hours, chores, manual). Online state unknown (no devices): nothing. */
export function LockPill({ kid }: { kid: TodayKid }) {
  if (kid.lock_reason) {
    return (
      <span className="pt-lockpill" data-locked="">
        <Icon name="lock" size={13} />
        {LOCK_TEXT[kid.lock_reason]}
      </span>
    )
  }
  return kid.devices.length ? <span className="pt-lockpill">Open</span> : null
}

/**
 * Today's day for one kid: two-arc ring (chores outer, online/allowed inner), facts, and a 7am-9pm timeline
 * (hatched = locked, grey = allowed, accent dot = chore done, line = now). Every mark has a tooltip (hover, tap).
 */
export function KidDay({ kid }: { kid: TodayKid }) {
  const clock = useClock()
  const tz = useFamily().data?.timezone
  const now = useNow()
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const done = kid.done ?? 0
  const total = kid.total ?? 0
  const hasOnline = kid.allowed_minutes != null
  const online = kid.online_minutes ?? 0
  const allowed = kid.allowed_minutes ?? 0
  const show = (e: PointerEvent) => {
    const t = (e.target as Element).closest('[data-tip]')
    setTip(t ? { text: t.getAttribute('data-tip') ?? '', x: e.clientX, y: e.clientY } : null)
  }
  const nowMin = minuteOfDay(new Date(now), tz)
  const label = hasOnline ? `${done} of ${total} chores done, ${online} of ${allowed} minutes online` : `${done} of ${total} done`
  return (
    <span className="pt-day" onPointerMove={show} onPointerDown={show} onPointerLeave={() => setTip(null)}>
      <span className="pt-ringrow">
        <svg className="pt-ring2" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={label} data-tip={hasOnline ? `Outer: ${done}/${total} chores · Inner: ${online}m of ${allowed}m online` : `${done}/${total} chores`}>
          <Arc r={R_OUT} f={frac(done, total)} cls="pt-arc-chores" w={6} />
          {hasOnline && <Arc r={R_IN} f={frac(online, allowed)} cls="pt-arc-online" w={5} />}
        </svg>
        <span className="pt-facts">
          <span className="pt-fact"><span className="pt-dt">Chores</span>{' '}<span className="pt-dd">{done}/{total}</span></span>
          {hasOnline && <span className="pt-fact"><span className="pt-dt">Online</span>{' '}<span className="pt-dd">{online}m of {allowed}m allowed</span></span>}
          <span className="pt-fact"><span className="pt-dt">Points</span>{' '}<span className="pt-dd">{kid.points ?? 0} pts</span></span>
        </span>
      </span>
      {kid.allowed && (
        <>
          <span className="pt-tl" aria-hidden="true">
            <span className="pt-tl-base" data-tip={`${kid.name ?? 'Kid'}: locked`} />
            {kid.allowed.map(([a, b]) => (
              <span key={`${a}-${b}`} className="pt-tl-win" style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} data-tip={`Online allowed ${hm(a)}–${hm(b)}`} />
            ))}
            {(kid.completions ?? []).map((c, i) => {
              const m = minuteOfDay(c.at, tz)
              return m >= DAY_START && m <= DAY_END ? <i key={i} className="pt-tl-dot" style={{ left: `${pct(m)}%` }} data-tip={`${c.title} · ${clock(c.at)}`} /> : null
            })}
            {nowMin >= DAY_START && nowMin <= DAY_END && <i className="pt-tl-now" style={{ left: `${pct(nowMin)}%` }} data-tip={`Now ${hm(nowMin)}`} />}
          </span>
          <span className="pt-tlx" aria-hidden="true"><span>7am</span><span>2pm</span><span>9pm</span></span>
        </>
      )}
      {tip && <span className="pt-tip" role="tooltip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 240), top: tip.y + 14 }}>{tip.text}</span>}
    </span>
  )
}
