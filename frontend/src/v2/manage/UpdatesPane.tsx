import { Switch } from '@mantine/core'
import { useUpdates, usePatchUpdates, type Updates } from '@/v2/hooks/useUpdates'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { Icon } from '@/v2/parent/Icon'
import { toastFail, toastOk } from '@/v2/notify'
import { PaneCard, PaneHead } from './PaneParts'
import { useFeatureOpen } from '@/v2/eval/featureMap'

// ponytail: eval channel detected server-side; if channel === 'eval', show as "Beta" and hide major UI
function isEval(channel: string): boolean {
  return channel === 'eval'
}

function statusColor(result: string | null): { color: string; icon: string } {
  if (!result) return { color: '', icon: 'help' }
  if (result.includes('Success') || result.includes('success')) {
    return { color: '#4a9d1f', icon: 'check' }
  }
  return { color: '#ff9b8f', icon: 'x' }
}

function resultMessage(data: Updates): string {
  if (!data.last_result) return 'No updates yet'
  const version = data.last_version || 'unknown'
  if (data.last_result === 'success') return `Updated to ${version}`
  return `Update to ${version} failed, still on ${data.version}`
}

function statusDisplay(result: string | null): string {
  if (result === 'success') return 'Success'
  if (result === 'failed') return 'Failed'
  return 'Pending'
}

export function UpdatesPane() {
  useFeatureOpen('updates')
  const updates = useUpdates()
  const patch = usePatchUpdates()
  const data = updates.data

  if (updates.isError)
    return (
      <>
        <PaneHead title="Updates" sub="Manage automatic updates and check for new versions." />
        <ErrorPanel kind="unreachable" error={updates.error} onRetry={() => updates.refetch()} />
      </>
    )

  if (updates.isPending)
    return (
      <>
        <PaneHead title="Updates" sub="Manage automatic updates and check for new versions." />
        <Skeleton rows={2} />
      </>
    )

  if (!data) return null

  const isBeta = isEval(data.channel)
  const { color, icon } = statusColor(data.last_result)

  return (
    <div className="pn">
      <PaneHead title="Updates" sub="Manage automatic updates and check for new versions." />

      <PaneCard icon="download" title="Version">
        <div className="pn-kv">
          <div className="pn-kv-row">
            <span className="pn-kv-key">Current:</span>
            <span className="pn-kv-val">{data.version}</span>
          </div>
        </div>
      </PaneCard>

      <PaneCard icon="refresh" title="Auto-update">
        <div className="pn-kv">
          <div className="pn-line">
            <span className="pn-kv-key">{isBeta ? 'Beta releases' : 'Nightly checks'}</span>
            <Switch
              className="pn-sw"
              aria-label="Toggle auto-update"
              checked={true}
              onChange={() =>
                patch.mutate(
                  { channel: isBeta ? 'eval' : 'stable' },
                  {
                    onError: (e) => toastFail(e),
                    onSuccess: () => toastOk('Saved'),
                  }
                )
              }
              disabled={patch.isPending}
            />
          </div>
          <p className="pn-help">
            {isBeta ? 'Beta releases install automatically when available.' : 'Minor and patch versions install automatically at 03:30.'}
          </p>
        </div>
      </PaneCard>

      <PaneCard icon="check" title="Last result">
        <div className="pn-kv">
          <div className="pn-kv-row">
            <span className="pn-kv-key">{resultMessage(data)}</span>
            <span className="pn-kv-val" style={{ color, fontWeight: 600 }}>
              {statusDisplay(data.last_result)}
            </span>
          </div>
        </div>
      </PaneCard>

      {!isBeta && data.major_available && (
        <PaneCard icon="security" title="Major versions">
          <p className="pn-help">Need your approval before installing.</p>
          <div className="pn-acts">
            <button
              className="p-btn"
              data-variant="accent"
              onClick={() =>
                patch.mutate(
                  { pull_major: data.major_available! },
                  {
                    onError: (e) => toastFail(e),
                    onSuccess: () => toastOk('Update triggered'),
                  }
                )
              }
              disabled={patch.isPending}
            >
              Version {data.major_available} available — Update
            </button>
          </div>
        </PaneCard>
      )}
    </div>
  )
}
