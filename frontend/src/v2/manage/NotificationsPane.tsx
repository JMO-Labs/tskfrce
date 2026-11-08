import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useResetState } from '@/v2/hooks/useResetState'
import { Switch, TextInput } from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { wallClock } from '@/v2/clockText'
import { useFamily } from '@/v2/hooks/useFamily'
import { useNotifySettings, usePatchNotifySettings, usePlaces, type NotifySettings, type SettingsPatch } from '@/v2/hooks/useNotify'
import { DetailHeader } from '@/v2/parent/DetailHeader'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import { EmptyState, ErrorPanel, Skeleton } from '@/v2/parent/states'
import { toastFail, toastOk } from '@/v2/notify'
import { IphoneBody, IphoneHelp, iphoneSummary, useBoxPush } from './IphoneRows'
import { PlaceDetail, PlaceSwitch } from './PlaceDetail'
import { PlaceForm } from './PlaceForm'

const QUIET = { quiet_start: '21:30', quiet_end: '07:00' }
type Save = (p: SettingsPatch) => Promise<boolean>
const ico = (name: string): ReactNode => <Icon name={name} size={18} />
const short = (hhmm: string) => wallClock(hhmm).replace(':00', '')

/** Saves a text field when it loses focus, if it changed. */
function useBlurField(saved: string, save: (v: string) => unknown) {
  const [v, setV] = useResetState(saved)
  return { value: v, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV(e.currentTarget.value), onBlur: () => v !== saved && void Promise.resolve(save(v)).then((ok) => ok === false && setV(saved)) }
}

/** Quiet hours body: From/To (saved as a pair only when both are set) and the security override. */
function QuietBody({ s, save }: { s: NotifySettings; save: Save }) {
  const [from, setFrom] = useResetState(s.quiet_start ?? '')
  const [to, setTo] = useResetState(s.quiet_end ?? '')
  if (s.quiet_start === null || s.quiet_end === null) return <p className="pk-hint">Off. Turn the switch on to pick quiet times.</p>
  const commit = () => {
    if (!from || !to || (from === s.quiet_start && to === s.quiet_end)) return
    void save({ quiet_start: from, quiet_end: to }).then((ok) => { if (!ok) { setFrom(s.quiet_start ?? ''); setTo(s.quiet_end ?? '') } })
  }
  const partial = !from || !to
  return (
    <>
      <div className="pn-times">
        <TimeInput label="From" value={from} onChange={(e) => setFrom(e.currentTarget.value)} onBlur={commit} aria-describedby={partial ? 'quiet-hint' : undefined} />
        <TimeInput label="To" value={to} onChange={(e) => setTo(e.currentTarget.value)} onBlur={commit} aria-describedby={partial ? 'quiet-hint' : undefined} />
      </div>
      {partial && <p id="quiet-hint" className="pk-hint">Pick both times</p>}
      <Switch
        className="pn-sw pn-line"
        label="Security alerts still send"
        labelPosition="left"
        checked={s.quiet_security}
        onChange={(e) => void save({ quiet_security: e.currentTarget.checked })}
      />
    </>
  )
}

/** App address body: one field that saves on blur. */
function AddressBody({ s, save, fallback }: { s: NotifySettings; save: Save; fallback: string }) {
  const field = useBlurField(s.app_address ?? '', (v) => save({ app_address: v.trim() || null }))
  return (
    <>
      <p className="pn-help">Used for links in pings and password reset links.</p>
      <TextInput aria-label="App address" className="pn-addr" placeholder={fallback} maxLength={200} {...field} />
      <p className="pn-help pn-note">Leave blank to use {fallback}.</p>
    </>
  )
}

const hostOf = (url: string) => { try { return new URL(url).host } catch { return url } }

export function NotificationsPane() {
  const places = usePlaces()
  const settings = useNotifySettings()
  const family = useFamily().data
  const box = useBoxPush()
  const patch = usePatchNotifySettings()
  const [adding, setAdding] = useState(false)
  const focus = useFocusParam('open', { valid: (id) => /^place-\d+$/.test(id) || ['quiet', 'iphones', 'address'].includes(id) })
  // one save at a time, in click order: a change made while another is saving waits, it is never dropped
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  /** resolves false when the box refused it */
  const save: Save = (p) => {
    const run = queue.current.then(() => patch.mutateAsync(p)).then(() => (toastOk('Saved'), true), (e) => (toastFail(e), false))
    queue.current = run
    return run
  }
  // a deleted place leaves a stale ?open=place-N: close it
  const gone = focus.open?.startsWith('place-') && !!places.data && !places.data.some((p) => `place-${p.id}` === focus.open)
  useEffect(() => { if (gone) focus.close() }, [gone]) // eslint-disable-line react-hooks/exhaustive-deps

  const s = settings.data
  const list = places.data
  const err = places.error ?? settings.error
  const fallback = s?.app_address_default ?? 'http://chores.local'
  const quietOn = !!s && s.quiet_start !== null && s.quiet_end !== null
  return (
    <div className="pn">
      <DetailHeader
        media={<span className="pk-tile pk-tile-lg"><Icon name="notifications" size={30} /></span>}
        title="Notifications"
        sub="Pings to the chat apps your family already uses."
        main={
          <button type="button" className="p-btn pn-add" data-variant="accent" onClick={() => setAdding(true)}>
            <Icon name="add" size={17} />
            Add a place
          </button>
        }
      />
      {err && <ErrorPanel kind="unreachable" error={err} onRetry={() => (places.refetch(), settings.refetch())} />}
      {(places.isPending || settings.isPending) && !err && <Skeleton rows={2} />}
      {s && list && list.length > 0 && (
        <div>
          <div className="p-sec-h">Places</div>
          <FocusArea focus={focus} label="Places" grouped>
            {list.map((p) => (
              <SummaryRow
                key={p.id}
                id={`place-${p.id}`}
                icon={ico('forum')}
                title={<span className="p-kn">{p.name}</span>}
                summary={`${p.events.length} of ${s.events.length} events`}
                line2={p.readable ? undefined : <span className="pn-warnline"><Icon name="warning" size={16} />Re-enter this address</span>}
                aside={<PlaceSwitch place={p} />}
                focus={focus}
              >
                <PlaceDetail place={p} events={s.events} />
              </SummaryRow>
            ))}
          </FocusArea>
        </div>
      )}
      {list?.length === 0 && (
        <EmptyState icon="notifications" title="No places yet" body="Add a Signal group, Discord channel, email or any Apprise address." />
      )}
      {s && list && (
        <div>
          <div className="p-sec-h">When and how</div>
          <FocusArea focus={focus} label="When and how" grouped>
            {list.length > 0 && (
              <SummaryRow
                id="quiet"
                icon={ico('bedtime')}
                title="Quiet hours"
                summary={quietOn ? `${short(s.quiet_start!)} – ${short(s.quiet_end!)}` : 'Off'}
                aside={<Switch className="pn-sw" aria-label="Quiet hours" checked={quietOn} onChange={(e) => void save(e.currentTarget.checked ? QUIET : { quiet_start: null, quiet_end: null })} />}
                focus={focus}
              >
                <QuietBody s={s} save={save} />
              </SummaryRow>
            )}
            <SummaryRow
              id="iphones"
              icon={ico('smartphone')}
              title="iPhones"
              info={<InfoPop label="How iPhone alerts work" width={300}><IphoneHelp /></InfoPop>}
              summary={iphoneSummary(family?.ntfy_upstream_relay, box?.enabled)}
              focus={focus}
            >
              <IphoneBody />
            </SummaryRow>
            <SummaryRow id="address" icon={ico('link')} title="App address" summary={s.app_address ? hostOf(s.app_address) : `Default (${fallback})`} focus={focus}>
              <AddressBody s={s} save={save} fallback={fallback} />
            </SummaryRow>
          </FocusArea>
        </div>
      )}
      <PlaceForm opened={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
