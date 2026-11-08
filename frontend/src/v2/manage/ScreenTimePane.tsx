import { Switch } from '@mantine/core'
import { usePatchScreenTime, useScreenTime } from '@/v2/hooks/useScreenTime'
import { useSaveQueue } from '@/v2/hooks/useSaveQueue'
import { DetailHeader } from '@/v2/parent/DetailHeader'
import { Icon } from '@/v2/parent/Icon'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import { ScreenKids } from './ScreenKids'
import { ScreenRules, type SaveScreen } from './ScreenRules'

const ROWS = ['price', 'max', 'save', 'gprice', 'auto', 'hrs']

/** Rewards → Screen time: the on switch, one line per rule, one row per kid. Every change saves as it is made. */
export function ScreenTimePane() {
  const q = useScreenTime()
  const patch = usePatchScreenTime()
  const run = useSaveQueue()
  const focus = useFocusParam('open', { valid: (id) => ROWS.includes(id) || /^kid-\d+$/.test(id) })
  const st = q.data
  if (q.isPending) return <Skeleton />
  if (q.isError || !st) return <ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} />
  const save: SaveScreen = (p) => run(() => patch.mutateAsync(p))
  return (
    <div className="pk-detail st">
      <DetailHeader
        media={<span className="pk-tile pk-tile-lg"><Icon name="timer" size={30} /></span>}
        title="Screen time"
        sub="Kids spend points on extra minutes. Changes save as you go."
        main={
          <Switch className="pn-sw" label={st.enabled ? 'On' : 'Off'} labelPosition="left" aria-label={`${st.enabled ? 'On' : 'Off'}, kids can buy extra minutes`} checked={st.enabled} onChange={(e) => void save({ enabled: e.currentTarget.checked })} />
        }
      />
      {st.enabled ? (
        <>
          <div>
            <div className="p-sec-h">Rules</div>
            <ScreenRules st={st} save={save} focus={focus} />
          </div>
          <ScreenKids st={st} focus={focus} />
        </>
      ) : (
        <p className="pk-hint">Turn this on to let kids spend points on extra internet time.</p>
      )}
    </div>
  )
}
