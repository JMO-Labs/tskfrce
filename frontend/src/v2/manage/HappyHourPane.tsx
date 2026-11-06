import { useFamily, usePatchFamily } from '@/v2/hooks/useFamily'
import { Icon } from '@/v2/parent/Icon'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import type { Family } from '@/v2/types'
import { toastFail } from '../notify'
import { multText, HappyHourButton } from '../today/HappyHourButton'
import { Switch } from './RewardDetail'

/** Rewards → Happy Hour: defaults and the two automatic Happy Hours. Each change saves on its own. */
export function HappyHourPane() {
  const q = useFamily()
  const patch = usePatchFamily()
  const fam = q.data
  if (q.isPending) return <Skeleton />
  if (q.isError || !fam) return <ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} />
  const save = (p: Partial<Family>) => patch.mutate(p, { onError: toastFail })
  return (
    <div className="pk-detail">
      <header className="pk-head">
        <div className="pk-head-t">
          <h2>Happy Hour</h2>
        </div>
        <div className="pk-actions">
          <HappyHourButton />
        </div>
      </header>
      <section className="pk-panel" aria-label="Defaults">
        <h3>
          <Icon name="bolt" size={18} className="rw-h3i" />
          Defaults
        </h3>
        <span className="pk-hint">Chores finished during a Happy Hour earn extra base points.</span>
        <span className="pk-label">Default multiplier</span>
        <SegmentedControl
          label="Default multiplier"
          value={String(fam.hh_default_mult_x10)}
          onChange={(v) => save({ hh_default_mult_x10: Number(v) as Family['hh_default_mult_x10'] })}
          options={([15, 20, 30] as const).map((m) => ({ value: String(m), label: multText(m) }))}
        />
        <span className="pk-label">Default length</span>
        <SegmentedControl
          label="Default length"
          value={String(fam.hh_default_minutes)}
          onChange={(v) => save({ hh_default_minutes: Number(v) as Family['hh_default_minutes'] })}
          options={([30, 60, 90] as const).map((m) => ({ value: String(m), label: `${m} min` }))}
        />
      </section>
      <section className="pk-panel" aria-label="Automatic">
        <h3>
          <Icon name="auto_awesome" size={18} className="rw-h3i" />
          Automatic
        </h3>
        <Switch id="hh-weekly" label="Surprise Happy Hour once a week" on={fam.hh_weekly_surprise} onChange={(v) => save({ hh_weekly_surprise: v })} />
        <span className="pk-hint pk-hint-tight">We&apos;ll pick a random weekday afternoon.</span>
        <Switch id="hh-auto" label="Auto boost when things go quiet" on={fam.hh_auto_boost} onChange={(v) => save({ hh_auto_boost: v })} />
        <span className="pk-hint pk-hint-tight">After 2 quiet days, we start a 1-hour Happy Hour for that kid and let you know.</span>
      </section>
    </div>
  )
}
