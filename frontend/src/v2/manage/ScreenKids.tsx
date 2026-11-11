import { useEffect, type FocusEvent } from 'react'
import { useResetState } from '@/v2/hooks/useResetState'
import { useDeleteLimit, useSetLimit } from '@/v2/hooks/useScreenTime'
import { useSaveQueue } from '@/v2/hooks/useSaveQueue'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import type { Focus } from '@/v2/parent/useFocusParam'
import type { ScreenKid, ScreenTime } from '@/v2/types'
import { fmtMin, initial, intError, wallTime } from './choreMeta'
import { ScreenField, type FieldMsg } from './ScreenField'

type Run = ReturnType<typeof useSaveQueue>

/** One kid's limit: the daily max and the points floor save as a pair, once both are valid. */
function KidBody({ kid, price, familyMax, run }: { kid: ScreenKid; price: number; familyMax: number | null; run: Run }) {
  const setLimit = useSetLimit()
  const del = useDeleteLimit()
  const name = kid.name ?? 'Kid'
  const savedMax = kid.limit?.max_minutes ?? null
  const savedMin = kid.limit?.min_points ?? null
  const [max, setMax] = useResetState(savedMax == null ? '' : String(savedMax))
  const [min, setMin] = useResetState(savedMin == null ? '' : String(savedMin))
  const maxErr = max.trim() ? intError(max, 15, 480) || (Number(max) % 15 ? 'Use steps of 15.' : '') : ''
  const minErr = min.trim() ? intError(min, 1, 100000) : ''
  const body = { max_minutes: max.trim() ? Number(max) : null, min_points: min.trim() ? Number(min) : null }
  const changed = body.max_minutes !== savedMax || body.min_points !== savedMin
  const cleared = changed && body.max_minutes == null && body.min_points == null
  const revert = () => { setMax(savedMax == null ? '' : String(savedMax)); setMin(savedMin == null ? '' : String(savedMin)) }
  // moving from one field of the pair to the other does not save yet
  const commit = (e: FocusEvent<HTMLInputElement>) => {
    if (e.relatedTarget && e.currentTarget.closest('.st-two')?.contains(e.relatedTarget)) return
    if (maxErr || minErr || !changed || cleared) return
    void run(() => setLimit.mutateAsync({ kidId: kid.kid_id, body })).then((ok) => ok || revert())
  }
  const msg = (text: string, tone: FieldMsg['tone'] = 'error'): FieldMsg | undefined => (text ? { text, tone } : undefined)
  return (
    <>
      <p className="pk-hint">{`${kid.balance} pts · up to ${fmtMin(Math.floor(kid.balance / price) * 15)}${kid.saved > 0 ? ` · saved ${kid.saved} min` : ''}`}</p>
      <div className="st-two">
        <ScreenField label="Daily limit (min)" name={`${name} daily limit (min)`} value={max} onChange={setMax} onCommit={commit} msg={msg(maxErr)} placeholder={familyMax == null ? 'No max' : `${familyMax} (family)`} />
        <ScreenField label="Not allowed until" unit="pts" name={`${name} not allowed until (pts)`} value={min} onChange={setMin} onCommit={commit} msg={msg(minErr)} placeholder="any time" />
      </div>
      {cleared && <p className="pk-hint">To clear both, use Remove limit.</p>}
      {kid.limit && (
        <button type="button" className="st-link" aria-label={`Remove limit for ${name}`} disabled={del.isPending} onClick={() => void run(() => del.mutateAsync(kid.kid_id))}>
          Remove limit
        </button>
      )}
    </>
  )
}

/** Kids section: one row per kid with the bought-today bar; the limit opens in place. */
export function ScreenKids({ st, focus }: { st: ScreenTime; focus: Focus }) {
  const run = useSaveQueue()
  // a deleted kid leaves a stale ?open=kid-N: close it
  const gone = focus.open?.startsWith('kid-') && !st.kids.some((k) => `kid-${k.kid_id}` === focus.open)
  useEffect(() => { if (gone) focus.close() }, [gone]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!st.kids.length) return null
  return (
    <div>
      <div className="p-sec-h st-kh">
        Kids
        <span>bought today · resets {wallTime(st.reset_time)}</span>
      </div>
      <FocusArea focus={focus} label="Kids" grouped>
        {st.kids.map((k) => {
          const name = k.name ?? 'Kid'
          const cap = k.max_minutes ? k.max_minutes + k.saved : 0
          return (
            <SummaryRow
              key={k.kid_id}
              id={`kid-${k.kid_id}`}
              icon={<span className="st-av" aria-hidden="true">{initial(name)}</span>}
              title={<span className="p-kn">{name}</span>}
              summary={k.limit?.max_minutes ? `${k.limit.max_minutes} min/day` : 'Family max'}
              line2={
                <>
                  {cap > 0 && <span className="pt-bar"><i style={{ width: `${Math.min(100, (k.bought_today / cap) * 100)}%` }} /></span>}
                  <span className="st-bought">{cap > 0 ? `${k.bought_today}/${cap} min today` : `${k.bought_today} min today`}</span>
                </>
              }
              focus={focus}
            >
              <KidBody kid={k} price={st.price} familyMax={st.max_minutes_per_day} run={run} />
            </SummaryRow>
          )
        })}
      </FocusArea>
    </div>
  )
}
