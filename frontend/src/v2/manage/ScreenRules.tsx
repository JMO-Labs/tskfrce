import Link from 'next/link'
import type { ReactNode } from 'react'
import { Switch } from '@mantine/core'
import { useResetState } from '@/v2/hooks/useResetState'
import type { ScreenPatch } from '@/v2/hooks/useScreenTime'
import { Icon } from '@/v2/parent/Icon'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import type { Focus } from '@/v2/parent/useFocusParam'
import type { ScreenTime } from '@/v2/types'
import { fmtMin, intError } from './choreMeta'
import { ScreenField, type FieldMsg } from './ScreenField'
import { MaxOptions } from './ScreenLimits'

/** resolves false when the box refused it */
export type SaveScreen = (p: ScreenPatch) => Promise<boolean>
interface BodyProps { st: ScreenTime; save: SaveScreen }

const ico = (name: string): ReactNode => <Icon name={name} size={18} />
const onOff = (v: boolean) => (v ? 'On' : 'Off')
/** Banking needs a daily max: the family's, or any kid's own. */
const bankable = (st: ScreenTime) => st.max_minutes_per_day != null || st.kids.some((k) => k.limit?.max_minutes != null)

function Sw({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <Switch className="pn-sw pn-line" label={label} labelPosition="left" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
}

function PriceBody({ st, save }: BodyProps) {
  const [v, setV] = useResetState(String(st.price))
  const err = intError(v, 1, 1000)
  const commit = () => {
    if (err || Number(v) === st.price) return
    void save({ price: Number(v) }).then((ok) => ok || setV(String(st.price)))
  }
  const buys = (pts: number) => fmtMin(Math.floor(pts / st.price) * 15)
  return (
    <>
      <ScreenField label="Points per 15 min" value={v} onChange={setV} onCommit={commit} msg={err ? { text: err, tone: 'error' } : undefined} />
      <p className="pk-hint">
        An average chore ({st.avg_chore_points} pts) buys {fmtMin(Math.round((st.avg_chore_points * 15) / st.price))}.
        {st.kids.length > 0 && ` Today ${st.kids.map((k, i) => `${k.name ?? 'Kid'} ${i ? '' : 'can buy up to '}${buys(k.balance)}`).join(', ')}.`}
      </p>
    </>
  )
}

function SaveBody({ st, save }: BodyProps) {
  const [cap, setCap] = useResetState(st.bank_cap == null ? '' : String(st.bank_cap))
  if (!bankable(st)) return <p className="pk-hint">Pick a max per day first, so there is something to save up to.</p>
  const max = st.max_minutes_per_day
  const empty = !cap.trim()
  const msg: FieldMsg | undefined = empty
    ? undefined
    : (() => {
        const e = intError(cap, 15, 480) || (Number(cap) % 15 ? 'Use steps of 15.' : '')
        if (e) return { text: e, tone: 'error' }
        return max != null && Number(cap) < max ? { text: `At least the daily max (${max} min), or leave empty.`, tone: 'hint' } : undefined
      })()
  const next = empty ? null : Number(cap)
  const commit = () => {
    if (msg || next === st.bank_cap) return
    void save({ bank_cap: next }).then((ok) => ok || setCap(st.bank_cap == null ? '' : String(st.bank_cap)))
  }
  return (
    <>
      <Sw label="Carry unused minutes over" checked={st.rollover} onChange={(v) => void save({ rollover: v })} />
      {st.rollover && (
        <ScreenField label="Save up to (min)" name="Save up to" value={cap} onChange={setCap} onCommit={commit} msg={msg} placeholder={max == null ? "Same as each kid's daily max" : `Same as the daily max (${max})`} />
      )}
      <p className="pk-hint">Minutes a kid doesn&apos;t buy today carry over, so they can save up for a bigger day.</p>
    </>
  )
}

/** Rewards › Screen time rules: one line per rule, each opening its own body. Every change saves as it is made. */
export function ScreenRules({ st, save, focus }: BodyProps & { focus: Focus }) {
  const cap = st.bank_cap ?? st.max_minutes_per_day
  const saveSummary = !st.rollover ? 'Off' : !bankable(st) ? 'Needs a max' : cap != null ? `On · up to ${cap} min` : 'On'
  return (
    <FocusArea focus={focus} label="Rules">
      <SummaryRow id="price" icon={ico('star')} title="Price" summary={`${st.price} pts = 15 min`} focus={focus}>
        <PriceBody st={st} save={save} />
      </SummaryRow>
      <SummaryRow id="max" icon={ico('timer')} title="Max per day" summary={st.max_minutes_per_day ? `${st.max_minutes_per_day} min` : 'No max'} focus={focus}>
        <select className="pk-input st-num" aria-label="Max per day" value={st.max_minutes_per_day ?? ''} onChange={(e) => void save({ max_minutes_per_day: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
          <MaxOptions keep={st.max_minutes_per_day} />
        </select>
      </SummaryRow>
      <SummaryRow id="save" icon={ico('trending_up')} title="Save unused time" summary={saveSummary} focus={focus}>
        <SaveBody st={st} save={save} />
      </SummaryRow>
      <SummaryRow id="gprice" icon={ico('devices')} title="Prices per device group" summary={onOff(st.group_pricing)} focus={focus}>
        <Sw label="Different prices for device groups" checked={st.group_pricing} onChange={(v) => void save({ group_pricing: v })} />
        <p className="pk-hint">Charge more for some devices, like game consoles.</p>
        {st.group_pricing && <Link className="st-link" href="/devices?tab=groups">Set group prices <span aria-hidden="true">›</span></Link>}
      </SummaryRow>
      <SummaryRow id="auto" icon={ico('check')} title="Approve automatically" summary={onOff(st.auto_approve)} focus={focus}>
        <Sw label="Approve buys without asking" checked={st.auto_approve} onChange={(v) => void save({ auto_approve: v })} />
        <p className="pk-hint">{st.auto_approve ? 'On: buys go through without waiting for you.' : 'Off: each buy waits in Needs you.'}</p>
      </SummaryRow>
      <SummaryRow id="hrs" icon={ico('bedtime')} title="Only during allowed hours" summary={onOff(st.only_in_allowed_hours)} focus={focus}>
        <Sw label="Only during allowed hours" checked={st.only_in_allowed_hours} onChange={(v) => void save({ only_in_allowed_hours: v })} />
        <p className="pk-hint">{st.only_in_allowed_hours ? 'Bought minutes can’t be used outside the hours rules.' : 'Bought minutes work even outside allowed hours, but never during off hours like bedtime.'}</p>
      </SummaryRow>
    </FocusArea>
  )
}
