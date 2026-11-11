import { Icon } from '@/v2/parent/Icon'
import type { KidToday } from '../../types'
import { tally } from '../kidChips'
import { useAskHomework } from '@/v2/hooks/useHomeworkRequest'
import { toastFail, toastOk } from '@/v2/notify'

const plural = (n: number) => (n === 1 ? 'chore' : 'chores')

/** Lock status with one progress dot per chore (10 .status). big = Kid mode, strip = phone. */
export function StatusBanner({ d, size }: { d: KidToday; size: 'big' | 'strip' }) {
  const t = tally(d.chores)
  const ask = useAskHomework()
  const hw = d.homework
  const until = hw ? new Date(hw.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
  const title = d.locked ? 'Internet is paused' : 'Internet is on'
  const wait = t.waiting ? ` · ${t.waiting} waiting for OK` : ''
  const filled = t.approved + t.waiting // a chore waiting for OK is finished from the kid's side
  let sub: string
  if (t.todo) sub = (d.locked ? `Finish ${t.todo} more ${plural(t.todo)} to turn it on` : `${t.todo} ${plural(t.todo)} left today`) + wait
  else if (t.waiting) sub = `All done. ${t.waiting} waiting for OK`
  else sub = d.locked ? 'It comes back on in your allowed hours.' : 'All done for today. Nice work!'
  if (hw) sub = `Homework mode is on until ${until}.`
  const live = d.chores.filter((c) => c.state !== 'skipped').slice(0, 10)
  return (
    <div className="k-status" data-size={size} data-open={!d.locked || undefined} role="status">
      <span className="k-status-big">
        <Icon name={d.locked ? 'lock' : 'wifi'} fill />
      </span>
      <div>
        <div className="k-status-t">{title}</div>
        <div className="k-status-s">{sub}</div>
        {d.locked && !hw && d.homework_pending && (
          <span className="k-chip" data-tone="wait" data-size="md">
            <Icon name="hourglass_top" />
            Waiting for a parent
          </span>
        )}
        {d.locked && !hw && !d.homework_pending && (
          <button type="button" className="k-bb" disabled={ask.isPending} onClick={() => ask.mutate(undefined, { onSuccess: () => toastOk('Asked a parent'), onError: toastFail })}>
            <Icon name="menu_book" />
            Ask for homework time
          </button>
        )}
      </div>
      {live.length > 0 && (
        <div className="k-dots" role="img" aria-label={`${filled} of ${t.total} done`}>
          {live.map((c, i) => (
            <i key={c.id} data-ok={i < filled || undefined}>
              {i < filled && <Icon name="check" />}
            </i>
          ))}
        </div>
      )}
    </div>
  )
}
