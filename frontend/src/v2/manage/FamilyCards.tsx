import { useState, type ReactNode } from 'react'
import { Input, PasswordInput, SegmentedControl, Switch } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { usePatchFamily } from '@/v2/hooks/useFamily'
import { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import type { Family } from '@/v2/types'
import { PasswordEye } from '@/v2/components/PasswordEye'
import { toastFail, toastOk } from '../notify'
import { PaneCard, PaneHead } from './PaneParts'
import { DetailHeader } from '@/v2/parent/DetailHeader'
import { Icon } from '@/v2/parent/Icon'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import { useSaveQueue } from '@/v2/hooks/useSaveQueue'
import { STYLE_LABEL } from '@/v2/presets/format'
import { PresetSwitch } from '@/v2/presets/PresetSwitch'
import { usePresets } from '@/v2/presets/usePresets'
import { GamesBody, gamesLine } from './GamesRow'
import { PenaltiesBody, penaltiesLine } from './PenaltiesBody'
import { BedtimeBody, bedtimeLine, HouseholdBody, householdLine, PointsBody, pointsLine, type SaveFamily } from './FamilyRows'

type Fields = Family & { giphy_api_key?: string; fingerbank_api_key?: string }

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

const ROWS = ['style', 'hh', 'bed', 'pts', 'games', 'pen']
const ico = (name: string) => <Icon name={name} size={18} />

/** Settings › Family: calm rows; every change saves as it is made (pairs once complete). */
export function FamilyCard({ fam }: { fam: Family }) {
  const focus = useFocusParam('open', { valid: (id) => ROWS.includes(id) })
  const patch = usePatchFamily()
  const queue = useSaveQueue()
  const qc = useQueryClient()
  const save: SaveFamily = (p) => queue(() => patch.mutateAsync(typeof p === 'function' ? p(qc.getQueryData<Family>(['family']) ?? fam) : p))
  const style = usePresets().data?.style
  const line = (id: string, t: string) => (focus.isOpen(id) ? undefined : t) // the open row shows its form instead
  return (
    <section aria-label="Family" className="pn fam-rows">
      <DetailHeader media={<span className="pk-tile pk-tile-lg"><Icon name="home" size={26} /></span>} title="Family" sub="The basics for your household." />
      <FocusArea focus={focus} label="Family settings" grouped>
        <SummaryRow id="style" icon={ico('tune')} title="Style" summary="" line2={line('style', STYLE_LABEL[style ?? 'balanced'])} focus={focus}>
          <PresetSwitch />
        </SummaryRow>
        <SummaryRow id="hh" icon={ico('home')} title="Household" summary="" line2={line("hh", householdLine(fam))} focus={focus}>
          <HouseholdBody fam={fam} save={save} />
        </SummaryRow>
        <SummaryRow id="bed" icon={ico('bedtime')} title="Bedtime & recap" summary="" line2={line("bed", bedtimeLine(fam))} focus={focus}>
          <BedtimeBody fam={fam} save={save} />
        </SummaryRow>
        <SummaryRow id="pts" icon={ico('stars')} title="Points rules" summary="" line2={line("pts", pointsLine(fam))} focus={focus}>
          <PointsBody fam={fam} save={save} />
        </SummaryRow>
        <SummaryRow id="games" icon={ico('sports_esports')} title="Minigames" summary="" line2={line('games', gamesLine(fam))} focus={focus}>
          <GamesBody fam={fam} save={save} />
        </SummaryRow>
        <SummaryRow id="pen" icon={ico('gavel')} title="Penalties" summary="" line2={line('pen', penaltiesLine(fam))} focus={focus}>
          <PenaltiesBody fam={fam} save={save} />
        </SummaryRow>
      </FocusArea>
    </section>
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

const FB_ERRORS: Record<string, string> = {
  bad_key: 'Fingerbank rejected your key. Check it and save again.',
  rate_limited: 'Fingerbank says too many requests. We will retry later.',
  offline: "Couldn't reach Fingerbank. We will retry in an hour.",
  invalid_db: 'Fingerbank sent something unexpected. We will retry in an hour.',
  failed: 'The last Fingerbank update failed. We will retry in an hour.',
}

/** Last Fingerbank failure in words (cloud_* codes share the texts), or null. */
export const fingerbankError = (code: string | null | undefined) => (code ? FB_ERRORS[code.replace(/^cloud_/, '')] ?? FB_ERRORS.failed : null)

export function FingerbankCard({ fam }: { fam: Family }) {
  return (
    <Pane title="Device names" sub="Recognise phones, consoles and TVs by type." fam={fam}>
      {({ val, set }) => (
        <PaneCard icon="devices" title="Better device names (Fingerbank)">
          <Switchy label="Better device names (Fingerbank)" checked={val('fingerbank_enabled')} onChange={(v) => set({ fingerbank_enabled: v })} />
          {val('fingerbank_enabled') ? (
            <>
              <div className="pn-fields">
                <PasswordInput
                  visibilityToggleIcon={PasswordEye}
                  label="Your Fingerbank key"
                  autoComplete="off"
                  placeholder={fam.fingerbank_key_set ? 'Saved' : ''}
                  value={val('fingerbank_api_key') ?? ''}
                  onChange={(e) => set({ fingerbank_api_key: e.currentTarget.value })}
                />
              </div>
              <Switchy label="Ask Fingerbank online instead of downloading its list" checked={val('fingerbank_cloud')} onChange={(v) => set({ fingerbank_cloud: v })} />
              {fingerbankError(fam.fingerbank_last_error) && (
                <p className="pn-help pn-note" role="alert">
                  {fingerbankError(fam.fingerbank_last_error)}
                </p>
              )}
              <p className="pn-help pn-note">
                Free account key from{' '}
                <a className="pn-link" href="https://api.fingerbank.org/users/register" target="_blank" rel="noreferrer">
                  fingerbank.org
                </a>
                . Your home box downloads Fingerbank&apos;s device list once, refreshes it weekly, and matches devices on the box. Nothing leaves your home unless you choose the online lookup, which sends each new device&apos;s network fingerprint to Fingerbank instead.
              </p>
            </>
          ) : (
            <p className="pn-help pn-note">Off. Turn on to show names like &quot;Android device&quot; instead of the maker or &quot;Unknown&quot; (needs your own free Fingerbank key).</p>
          )}
        </PaneCard>
      )}
    </Pane>
  )
}
