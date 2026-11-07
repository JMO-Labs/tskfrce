import { useState, type ReactNode } from 'react'
import { Input, NativeSelect, NumberInput, PasswordInput, SegmentedControl, Switch, TextInput } from '@mantine/core'
import { useBlocker } from '@/v2/hooks/useDevices'
import { usePatchFamily } from '@/v2/hooks/useFamily'
import { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import type { Family } from '@/v2/types'
import { PasswordEye } from '@/v2/components/PasswordEye'
import { toastFail, toastOk } from '../notify'
import { PaneCard, PaneHead } from './PaneParts'
import { Chip } from '@/v2/parent/Chip'
import { Fold } from '@/v2/parent/Fold'
import { ago } from './settingsMeta'
import { wallClock } from '@/v2/clockText'
import { bedtimeAt, bedtimeLatest, bedtimePossible } from '@/v2/trustTypes'

function zones(current: string): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  return all.includes(current) ? all : [current, ...all]
}

type Fields = Family & { giphy_api_key?: string }

interface Draft {
  val: <K extends keyof Fields>(k: K) => Fields[K]
  set: (p: Partial<Fields>) => void
}

/** A settings pane: only changed fields are PATCHed; Save is enabled once something differs. */
function Pane({ title, sub, fam, children }: { title: string; sub: string; fam: Family; children: (d: Draft) => ReactNode }) {
  const patch = usePatchFamily()
  const [draft, setDraft] = useState<Partial<Fields>>({})
  const val = <K extends keyof Fields>(k: K) => (k in draft ? draft[k] : (fam as Fields)[k]) as Fields[K]
  const set = (p: Partial<Fields>) => setDraft((d) => ({ ...d, ...p }))
  const changed = Object.fromEntries(
    Object.entries(draft).filter(([k, v]) => v !== (fam as Fields)[k as keyof Fields]),
  ) as Partial<Fields>
  const dirty = Object.keys(changed).length > 0
  const blankName = !val('name').trim()
  const once = useSingleFlight()
  const save = () =>
    once(() =>
      patch.mutateAsync(changed).then(
        () => {
          toastOk('Saved')
          setDraft({})
        },
        toastFail,
      ),
    )
  return (
    <section aria-label={title} className="pn">
      <PaneHead title={title} sub={sub} />
      <form
        className="pn"
        onSubmit={(e) => {
          e.preventDefault() // Enter in a field saves, once
          if (dirty && !blankName && !patch.isPending) save()
        }}
      >
        {children({ val, set })}
        <div>
          <button type="submit" className="p-btn" data-variant="accent" disabled={!dirty || blankName || patch.isPending} aria-busy={patch.isPending}>
            Save settings
          </button>
        </div>
      </form>
    </section>
  )
}

const Switchy = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="pn-kv">
    <Switch className="pn-sw" label={label} labelPosition="left" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
  </div>
)

/** Home box heartbeat as a status row (mockup: Network card). */
function BoxRow() {
  const box = useBlocker().data
  if (!box) return null
  return (
    <div className="pn-kv pn-box">
      <span>Home box</span>
      <Chip tone={box.online ? 'acc' : 'amb'} icon={box.online ? 'check_circle' : 'router'}>
        {box.online ? `Healthy${process.env.NEXT_PUBLIC_APP_VERSION ? ` · v${process.env.NEXT_PUBLIC_APP_VERSION}` : ''}` : `Offline — ${box.last_seen ? `last seen ${ago(box.last_seen)}` : 'never seen'}`}
      </Chip>
    </div>
  )
}

export function FamilyCard({ fam }: { fam: Family }) {
  return (
    <Pane title="Family" sub="The basics for your household." fam={fam}>
      {({ val, set }) => (
        <>
          <PaneCard icon="home" title="Household">
            <div className="pn-fields">
              <TextInput
                label="Family name"
                value={val('name')}
                error={val('name').trim() ? undefined : 'Give your family a name.'}
                onChange={(e) => set({ name: e.currentTarget.value })}
              />
              <NativeSelect
                label="Time zone"
                data={zones(fam.timezone)}
                value={val('timezone')}
                onChange={(e) => set({ timezone: e.currentTarget.value })}
              />
              <TextInput
                type="time"
                label="Day resets at"
                description="Chores start fresh at this time."
                value={val('reset_time')}
                onChange={(e) => {
                  const r = e.currentTarget.value
                  set(val('bedtime_auto') && bedtimePossible(r) ? { reset_time: r, bedtime_auto_at: bedtimeAt(val('bedtime_auto_at'), r) } : { reset_time: r })
                }}
              />
            </div>
          </PaneCard>
          <PaneCard icon="auto_awesome" title="Extras">
            <div className="pn-kv">
              <Switch
                className="pn-sw"
                label="Bedtime auto-approve"
                description={
                  bedtimePossible(val('reset_time'))
                    ? 'Chores still waiting approve themselves each night.'
                    : 'Move the day reset later than 6:15 PM to use this.'
                }
                labelPosition="left"
                disabled={!bedtimePossible(val('reset_time')) && !val('bedtime_auto')}
                checked={!!val('bedtime_auto')}
                onChange={(e) =>
                  set(e.currentTarget.checked ? { bedtime_auto: true, bedtime_auto_at: bedtimeAt(val('bedtime_auto_at'), val('reset_time')) } : { bedtime_auto: false })
                }
              />
            </div>
            {val('bedtime_auto') && bedtimePossible(val('reset_time')) && (
              <div className="pn-fields">
                <TextInput
                  type="time"
                  label="Approve at"
                  min="18:00"
                  max={bedtimeLatest(val('reset_time'))}
                  description={bedtimeLatest(val('reset_time')) < '23:30' ? `Latest is ${wallClock(bedtimeLatest(val('reset_time')))}, 15 minutes before the day resets.` : undefined}
                  step={900}
                  value={val('bedtime_auto_at') ?? '21:00'}
                  onChange={(e) => set({ bedtime_auto_at: e.currentTarget.value })}
                />
              </div>
            )}
            <div className="pn-sp" />
            <div className="pn-kv">
              <Switch
                className="pn-sw"
                label="Weekly recap"
                description="A short summary of each kid's week, Sundays at 7:30 PM."
                labelPosition="left"
                checked={val('recap_weekly') !== false}
                onChange={(e) => set({ recap_weekly: e.currentTarget.checked })}
              />
            </div>
          </PaneCard>
          <Fold title="Points rules">
            <section className="pn-card" aria-label="Points rules">
              <div className="pn-fields">
                <NumberInput
                  label="Early finish bonus cap"
                  description="Most bonus points a kid can earn for finishing chores early."
                  min={0}
                  max={50}
                  allowDecimal={false}
                  value={val('early_bonus_cap')}
                  onChange={(v) => typeof v === 'number' && set({ early_bonus_cap: v })}
                />
              </div>
              <div className="pn-sp" />
              <Switchy label="Streak freezes" checked={val('streak_freeze')} onChange={(v) => set({ streak_freeze: v })} />
              <p className="pn-help pn-note">Kids earn a freeze every 7 days in a row; it covers one missed day.</p>
            </section>
          </Fold>
          <PaneCard icon="shield" title="Network">
            <Switchy
              label="Block new devices until I assign them"
              checked={val('new_devices_blocked')}
              onChange={(v) => set({ new_devices_blocked: v })}
            />
            <p className="pn-help pn-note">New phones and laptops stay paused until you give them an owner.</p>
            <BoxRow />
          </PaneCard>
        </>
      )}
    </Pane>
  )
}

export function GifsCard({ fam }: { fam: Family }) {
  return (
    <Pane title="GIFs" sub="GIF search in chat." fam={fam}>
      {({ val, set }) => (
        <PaneCard icon="gif_box" title="GIPHY">
          <Switchy label="Allow GIFs in chat" checked={val('gifs_enabled')} onChange={(v) => set({ gifs_enabled: v })} />
          {val('gifs_enabled') ? (
            <>
              <div className="pn-fields">
                <Input.Wrapper label="GIF rating">
                  <SegmentedControl
                    aria-label="GIF rating"
                    data={[
                      { label: 'G (all ages)', value: 'g' },
                      { label: 'PG', value: 'pg' },
                    ]}
                    value={val('gif_rating')}
                    onChange={(v) => set({ gif_rating: v as 'g' | 'pg' })}
                  />
                </Input.Wrapper>
                <PasswordInput
                  visibilityToggleIcon={PasswordEye}
                  label="GIPHY key"
                  autoComplete="off"
                  placeholder={fam.giphy_key_set ? 'Saved' : ''}
                  value={val('giphy_api_key') ?? ''}
                  onChange={(e) => set({ giphy_api_key: e.currentTarget.value })}
                />
              </div>
              <p className="pn-help pn-note">
                Free. Create an app, copy its API key.{' '}
                <a className="pn-link" href="https://developers.giphy.com/dashboard/" target="_blank" rel="noreferrer">
                  developers.giphy.com/dashboard
                </a>
                . When on, GIF searches are sent to GIPHY through your home box. Your kids&apos; devices never talk to GIPHY directly.
              </p>
            </>
          ) : (
            <p className="pn-help pn-note">Off. Turn on to search GIFs in chat (needs a free GIPHY key).</p>
          )}
        </PaneCard>
      )}
    </Pane>
  )
}
