import { useState } from 'react'
import { useKids } from '@/v2/hooks/useKids'
import { useRewardHistory, type HistoryQuery } from '@/v2/hooks/useRewards'
import { Chip } from '@/v2/parent/Chip'
import { DetailHeader } from '@/v2/parent/DetailHeader'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import { KidPicker } from '@/v2/parent/KidPicker'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import { EmptyState, ErrorPanel, Skeleton } from '@/v2/parent/states'
import type { HistoryRow } from '@/v2/types'
import { daysAgo } from '../clockText'
import { fmtMin, initial } from './choreMeta'
import { downloadCsv, toCsv } from './historyCsv'

type Kind = NonNullable<HistoryQuery['kind']>

/** "Today 5:12 PM", "Yesterday", "Mon", else "Oct 3". */
export function whenAt(iso: string, now = new Date()) {
  const d = new Date(iso)
  const diff = daysAgo(iso, now)
  if (diff === 0) return `Today ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function Row({ r }: { r: HistoryRow }) {
  const kid = r.kid_name ?? 'Kid'
  const by = r.decided_by_name ?? 'a parent'
  const denied = r.status === 'denied'
  const how = r.auto ? 'Auto-approved' : denied ? `Declined by ${by}` : `Approved by ${by}`
  const pop = (
    <div className="rh-pop">
      <p><b>{r.name}</b><br />{kid} · {whenAt(r.decided_at ?? r.created_at)}</p>
      <div className="rh-lg"><span>{how}</span><b>{denied ? '0' : `−${r.cost} pts`}</b></div>
      {r.note && <p>“{r.note}”</p>}
      {r.kind === 'screen_time' && !denied && r.minutes != null && <div className="rh-lg"><span>Screen time</span><b>{fmtMin(r.minutes)}</b></div>}
    </div>
  )
  return (
    <li className="rh-li">
      <InfoPop label={`${r.name}, details`} target={
        <button type="button" className="rh-row">
          <span className="pk-av" aria-hidden="true">{initial(kid)}</span>
          <span className="rh-t">{r.name}<small>{kid} · {whenAt(r.decided_at ?? r.created_at)}</small></span>
          {r.auto ? <Chip tone="lav" icon="bolt">Auto</Chip> : denied ? <Chip tone="grey" icon="close">Declined</Chip> : null}
          <b className={denied ? 'rh-amt rh-amt-off' : 'rh-amt'}>{denied ? '0' : `−${r.cost}`}</b>
        </button>
      }>{pop}</InfoPop>
    </li>
  )
}

const ALL = 'all'
const TYPES: { value: Kind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'reward', label: 'Rewards' },
  { value: 'screen_time', label: 'Screen time' },
]

/** Rewards → History: totals chip, kid pills, type switch, one row per purchase, Export CSV. */
export function RewardsHistory() {
  const kids = useKids().data ?? []
  const [kidId, setKidId] = useState<number | undefined>()
  const [type, setType] = useState<Kind | 'all'>('all')
  const kind = type === 'all' ? undefined : type
  const q = useRewardHistory({ days: 30, kid_id: kidId, kind })
  const rows = q.data?.rows ?? []
  const t = q.data?.totals
  const who = kids.find((k) => k.id === kidId)?.full_name
  const totals = t && (
    <div className="rh-st">
      <div className="rh-sh">Last 30 days{who ? ` · ${who}` : ''}</div>
      <div>Spent<b>{t.spent.toLocaleString()} pts</b></div>
      <div>Screen time bought<b>{fmtMin(t.screen_minutes)}</b></div>
      <div>Approved<b>{t.approved}</b></div>
      <div>Declined<b>{t.declined}</b></div>
    </div>
  )
  return (
    <div className="pk-detail rh">
      <DetailHeader
        media={<span className="pk-tile pk-tile-lg"><Icon name="history" size={30} /></span>}
        title="History"
        sub="Every reward and screen-time purchase."
        main={
          <button type="button" className="p-btn" disabled={!rows.length} onClick={() => downloadCsv('rewards-history.csv', toCsv(rows))}>
            <Icon name="download" size={16} />
            Export CSV
          </button>
        }
      />
      {totals && (
        <div className="rh-chips">
          <InfoPop label="Totals for the last 30 days" target={
            <button type="button" className="p-pill" data-tone="acc" aria-label={`${t.spent.toLocaleString()} pts spent, 30 days. Totals`}>
              <Icon name="star" size={16} />
              {t.spent.toLocaleString()} pts spent · 30 days
              <Icon name="info" size={14} />
            </button>
          }>{totals}</InfoPop>
        </div>
      )}
      <KidPicker
        variant="pills" single extrasFirst label="Kid" kids={kids}
        extras={[{ value: ALL, label: 'All kids' }]}
        value={[kidId == null ? ALL : String(kidId)]}
        onChange={(v) => setKidId(v[0] && v[0] !== ALL ? Number(v[0]) : undefined)}
      />
      <SegmentedControl label="Type" value={type} onChange={setType} options={TYPES} />
      <section className="pk-panel rw-rows rh-panel" aria-label="History rows">
        {q.isPending ? (
          <Skeleton />
        ) : q.isError ? (
          <ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length ? (
          <ul className="rh-list">
            {rows.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <EmptyState icon="history" title="Nothing yet" body="Rewards and screen time kids buy show up here." />
        )}
      </section>
    </div>
  )
}
