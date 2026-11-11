import { useState } from 'react'
import { useGoalSettings, usePatchGoalSettings } from '@/v2/hooks/useGoals'
import type { GoalSettings } from '@/v2/goalTypes'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { toastFail } from '../notify'
import { PaneCard, PaneHead } from './PaneParts'

type Flag = 'on' | 'suggest' | 'withdraw' | 'siblings' | 'auto' | 'screen_on' | 'jail_on'
type Num = 'auto_pct' | 'max_little' | 'max_kid' | 'max_teen' | 'screen_price' | 'screen_minutes' | 'jail_price'

function Num({ id, label, value, save }: { id: Num; label: string; value: number; save: (p: Partial<GoalSettings>) => void }) {
  const [v, setV] = useState(String(value))
  return (
    <label className="pk-field gl-num">
      <span className="pk-label">{label}</span>
      <input
        className="pk-input"
        type="number"
        min={1}
        inputMode="numeric"
        value={v}
        onChange={(e) => setV(e.currentTarget.value)}
        onBlur={() => {
          const n = Number(v)
          if (n > 0 && n !== value) save({ [id]: n })
          else setV(String(value))
        }}
      />
    </label>
  )
}

function Flag({ id, label, on, save, disabled, hint }: { id: Flag; label: string; on: boolean; save: (p: Partial<GoalSettings>) => void; disabled?: boolean; hint?: string }) {
  return (
    <>
      <div className="pk-switch rw-sw">
        <span id={`gs-${id}`}>{label}</span>
        <button type="button" role="switch" aria-checked={on} aria-labelledby={`gs-${id}`} disabled={disabled} onClick={() => save({ [id]: !on })} />
      </div>
      {hint && <span className="pk-hint pk-hint-tight">{hint}</span>}
    </>
  )
}

/** Goals → settings. Every change saves on its own, sending only that field. */
export function GoalSettingsPane({ onBack }: { onBack: () => void }) {
  const q = useGoalSettings()
  const patch = usePatchGoalSettings()
  const save = (p: Partial<GoalSettings>) => patch.mutate(p, { onError: toastFail })
  const back = <button type="button" className="gl-back" onClick={onBack}>‹ Goals</button>
  const head = <PaneHead title="Goal settings" sub="How kids save up for bigger things." />
  if (q.isPending) return <div className="pk-detail">{back}{head}<Skeleton rows={2} /></div>
  if (q.isError || !q.data) return <div className="pk-detail">{back}{head}<ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} /></div>
  const s = q.data
  return (
    <div className="pk-detail">
      {back}
      {head}
      <PaneCard icon="flag" title="Goals">
        <Flag id="on" label="Goals on" on={s.on} save={save} />
        <Flag id="suggest" label="Kids can suggest goals" on={s.suggest} save={save} />
      </PaneCard>
      <PaneCard icon="group" title="Kids">
        <Flag id="withdraw" label="Kids can take points back" on={s.withdraw} save={save} />
        <Flag id="siblings" label="Kids see what siblings gave" on={s.siblings} save={save} />
      </PaneCard>
      <PaneCard icon="savings" title="Points in">
        <Flag id="auto" label="Share chore points automatically" on={s.auto} save={save} hint="Off means kids add points by hand." />
        <Num id="auto_pct" label="Share of each chore, %" value={s.auto_pct} save={save} />
      </PaneCard>
      <PaneCard icon="tune" title="Limits by age">
        <Num id="max_little" label="Little kids" value={s.max_little} save={save} />
        <Num id="max_kid" label="Kids" value={s.max_kid} save={save} />
        <Num id="max_teen" label="Teens" value={s.max_teen} save={save} />
      </PaneCard>
      <PaneCard icon="redeem" title="Built-ins">
        <Flag id="screen_on" label="Extra screen time" on={s.screen_on} save={save} disabled={!s.screen_ok} hint={s.screen_ok ? undefined : 'Turn on screen time first'} />
        <Num id="screen_price" label="Price, points" value={s.screen_price} save={save} />
        <Num id="screen_minutes" label="Minutes" value={s.screen_minutes} save={save} />
        <Flag id="jail_on" label="Get out of jail free" on={s.jail_on} save={save} />
        <Num id="jail_price" label="Price, points" value={s.jail_price} save={save} />
      </PaneCard>
    </div>
  )
}
