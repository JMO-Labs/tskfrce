import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Switch } from '@mantine/core'
import { wallClock } from '@/v2/clockText'
import { useResetState } from '@/v2/hooks/useResetState'
import { InfoPop } from '@/v2/parent/InfoPop'
import { bedtimeAt, bedtimeLatest, bedtimePossible } from '@/v2/trustTypes'
import type { Family } from '@/v2/types'
import { intError } from './choreMeta'

/** Saves a partial change; resolves false when the box refused it. A function is given the latest saved family
 *  when its turn comes, so a field derived from other settings never goes out stale. */
export type SaveFamily = (p: Partial<Family> | ((latest: Family) => Partial<Family>)) => Promise<boolean>
interface Props { fam: Family; save: SaveFamily }

const city = (tz: string) => (tz.split('/').pop() ?? tz).replace(/_/g, ' ')
const hhmm = /^\d\d:\d\d$/

export function zones(current: string): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  return all.includes(current) ? all : [current, ...all]
}

export const householdLine = (f: Family) => `${f.name.trim() || 'No name yet'} · ${city(f.timezone)} time · day resets ${wallClock(f.reset_time)}`
export const bedtimeLine = (f: Family) =>
  `${f.bedtime_auto ? `Auto-approve ${wallClock(bedtimeAt(f.bedtime_auto_at, f.reset_time))}` : 'No auto-approve'} · Recap ${f.recap_weekly !== false ? 'on' : 'off'}`
export const pointsLine = (f: Family) => `Early bonus up to ${f.early_bonus_cap} pts · Streak freezes ${f.streak_freeze ? 'on' : 'off'}`

/** One label-left, control-right line, optionally with an (i). */
export function Setr({ label, info, children }: { label: string; info?: ReactNode; children: ReactNode }) {
  return (
    <div className="ch-setr fam-setr">
      <span className="ch-lb">{label}</span>
      {children}
      {info}
    </div>
  )
}
export const Info = ({ label, children }: { label: string; children: ReactNode }) => (
  <InfoPop label={label} width={260}><div className="ch-pop-p">{children}</div></InfoPop>
)
/** Switch that saves the moment it is flipped. */
export const Sw = ({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <Switch className="pn-sw" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
)

/** The last value sent or saved for a field. Starts at (and follows) the prop, but a send moves it at once, so A to B to A before a refetch still sends the second change. */
function useSent<T>(prop: T) {
  const sent = useRef(prop)
  useEffect(() => { sent.current = prop }, [prop])
  return sent
}

const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur()

export function HouseholdBody({ fam, save }: Props) {
  const [name, setName] = useResetState(fam.name)
  const [reset, setReset] = useResetState(fam.reset_time)
  const sentNameRef = useSent(fam.name)
  const sentResetRef = useSent(fam.reset_time)
  const blank = !name.trim()
  const commitName = () => {
    const v = name.trim()
    if (blank || v === sentNameRef.current) return
    const prev = sentNameRef.current
    sentNameRef.current = v
    void save({ name: v }).then((ok) => { if (!ok) { sentNameRef.current = prev; setName(prev) } })
  }
  const commitReset = () => {
    if (!hhmm.test(reset) || reset === sentResetRef.current) return
    const prev = sentResetRef.current
    sentResetRef.current = reset
    void save((f) => (f.bedtime_auto && bedtimePossible(reset) ? { reset_time: reset, bedtime_auto_at: bedtimeAt(f.bedtime_auto_at, reset) } : { reset_time: reset }))
      .then((ok) => { if (!ok) { sentResetRef.current = prev; setReset(prev) } })
  }
  return (
    <>
      <label className="pk-field">
        <span className="pk-label">Family name</span>
        <input className="pk-input" value={name} aria-invalid={blank} aria-describedby={blank ? 'fam-name-err' : undefined} autoComplete="off" onChange={(e) => setName(e.currentTarget.value)} onBlur={commitName} onKeyDown={commitOnEnter} />
        {blank && <span id="fam-name-err" role="alert" className="pk-error">Give your family a name.</span>}
      </label>
      <label className="pk-field">
        <span className="pk-label">Time zone</span>
        <select className="pk-input" value={fam.timezone} onChange={(e) => void save({ timezone: e.currentTarget.value })}>
          {zones(fam.timezone).map((z) => <option key={z}>{z}</option>)}
        </select>
      </label>
      <div className="ch-setl">
        <Setr label="Day resets at" info={<Info label="About the day reset">Chores start fresh at this time each day.</Info>}>
          <input className="pk-input ch-w" type="time" aria-label="Day resets at" value={reset} onChange={(e) => setReset(e.currentTarget.value)} onBlur={commitReset} onKeyDown={commitOnEnter} />
        </Setr>
      </div>
    </>
  )
}

export function BedtimeBody({ fam, save }: Props) {
  const possible = bedtimePossible(fam.reset_time)
  const latest = bedtimeLatest(fam.reset_time)
  const saved = fam.bedtime_auto_at ? bedtimeAt(fam.bedtime_auto_at, fam.reset_time) : ''
  const [on, setOn] = useResetState(!!fam.bedtime_auto)
  const [at, setAt] = useResetState(saved)
  const sentOnRef = useSent(!!fam.bedtime_auto)
  const sentAtRef = useSent(fam.bedtime_auto_at)
  const [asked, setAsked] = useState(false) // the hint waits until the parent has tried
  const okAt = (t: string) => hhmm.test(t) && t >= '18:00' && t <= latest
  /** The pair (switch + time) saves only when both are good; until then it stays a local draft. */
  const commit = (nextOn: boolean, nextAt: string) => {
    if (!okAt(nextAt)) return
    const p: Partial<Family> = {}
    const prevOn = sentOnRef.current, prevAt = sentAtRef.current
    if (nextOn !== prevOn) p.bedtime_auto = nextOn
    if (nextAt !== prevAt) p.bedtime_auto_at = nextAt
    if (!Object.keys(p).length) return
    sentOnRef.current = nextOn; sentAtRef.current = nextAt
    void save(p).then((ok) => { // revert only what that save carried
      if (ok) return
      if ('bedtime_auto' in p) { sentOnRef.current = prevOn; setOn(prevOn) }
      if ('bedtime_auto_at' in p) { sentAtRef.current = prevAt; setAt(prevAt ? bedtimeAt(prevAt, fam.reset_time) : '') }
    })
  }
  const flip = (v: boolean) => {
    setOn(v)
    setAsked(true)
    if (!v) {
      const prev = sentOnRef.current
      sentOnRef.current = false
      if (prev) void save({ bedtime_auto: false }).then((ok) => { if (!ok) { sentOnRef.current = prev; setOn(prev) } })
    } else commit(true, at)
  }
  const hint = on && possible && !okAt(at) && asked
  const recap = fam.recap_weekly !== false
  return (
    <div className="ch-setl">
      <Setr label="Bedtime auto-approve" info={<Info label="About bedtime auto-approve"><p>Chores still waiting for your OK approve themselves each night.</p><p>Needs the day reset later than 6:15 PM. Pick a time from 6 PM to 15 minutes before the day resets.</p></Info>}>
        <Sw label="Bedtime auto-approve" checked={on} disabled={!possible && !fam.bedtime_auto} onChange={flip} />
      </Setr>
      {!possible && <span className="pk-hint ch-hint">Move the day reset later than 6:15 PM to use this.</span>}
      {on && possible && (
        <Setr label="Approve at">
          <input
            className="pk-input ch-w"
            type="time"
            aria-label="Approve at"
            min="18:00"
            max={latest}
            step={900}
            value={at}
            aria-invalid={hint}
            aria-describedby={hint ? 'fam-bed-hint' : undefined}
            onChange={(e) => setAt(e.currentTarget.value)}
            onBlur={() => { setAsked(true); commit(on, at) }}
            onKeyDown={commitOnEnter}
          />
        </Setr>
      )}
      {on && possible && (hint || latest < '23:30') && (
        <span id="fam-bed-hint" className="pk-hint ch-hint">
          {hint ? `Pick a time from 6:00 PM to ${wallClock(latest)} to turn this on.` : `Latest is ${wallClock(latest)}, 15 minutes before the day resets.`}
        </span>
      )}
      <Setr label="Weekly recap" info={<Info label="About the weekly recap">A short summary of each kid&apos;s week, Sundays at 7:30 PM.</Info>}>
        <Sw label="Weekly recap" checked={recap} onChange={(v) => void save({ recap_weekly: v })} />
      </Setr>
    </div>
  )
}

export function PointsBody({ fam, save }: Props) {
  const [cap, setCap] = useResetState(String(fam.early_bonus_cap))
  const sentCapRef = useSent(fam.early_bonus_cap)
  const err = intError(cap, 0, 50)
  const commit = () => {
    if (err || Number(cap) === sentCapRef.current) return
    const prev = sentCapRef.current
    sentCapRef.current = Number(cap)
    void save({ early_bonus_cap: Number(cap) }).then((ok) => { if (!ok) { sentCapRef.current = prev; setCap(String(prev)) } })
  }
  return (
    <div className="ch-setl">
      <Setr label="Early finish bonus cap" info={<Info label="About the bonus cap">Most bonus points a kid can earn for finishing chores early. 0 to 50.</Info>}>
        <input className="pk-input ch-w" inputMode="numeric" aria-label="Early finish bonus cap" value={cap} aria-invalid={!!err} aria-describedby={err ? 'fam-cap-err' : undefined} onChange={(e) => setCap(e.currentTarget.value)} onBlur={commit} onKeyDown={commitOnEnter} />
      </Setr>
      {err && <span id="fam-cap-err" className="pk-error ch-hint">{err}</span>}
      <Setr label="Streak freezes" info={<Info label="About streak freezes">Kids earn a freeze every 7 days in a row. It covers one missed day.</Info>}>
        <Sw label="Streak freezes" checked={fam.streak_freeze} onChange={(v) => void save({ streak_freeze: v })} />
      </Setr>
    </div>
  )
}
