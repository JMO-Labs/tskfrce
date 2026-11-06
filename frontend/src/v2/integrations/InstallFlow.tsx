import { useEffect, useRef, useState } from 'react'
import { Checkbox, NumberInput, PasswordInput, Select, Switch, TextInput } from '@mantine/core'
import { errorText } from '@/v2/api'
import { useLibrary } from '@/v2/hooks/useChores'
import { useInstallIntegration } from '@/v2/hooks/useIntegrations'
import { useKids } from '@/v2/hooks/useKids'
import { Icon } from '@/v2/parent/Icon'
import { Skeleton } from '@/v2/parent/states'
import { toastFail } from '@/v2/notify'
import { PermissionList } from './PermissionList'
import type { CatalogItem, SettingFieldOut } from './types'

type Vals = Record<string, string>

function Field({ f, value, set }: { f: SettingFieldOut; value: string; set: (v: string) => void }) {
  const common = { label: f.label, required: f.required, withAsterisk: f.required }
  if (f.type === 'select')
    return <Select {...common} data={f.options} value={value || null} onChange={(v) => set(v ?? '')} allowDeselect={false} />
  if (f.type === 'number') return <NumberInput {...common} value={value} onChange={(v) => set(String(v))} allowDecimal={false} />
  if (f.secret) return <PasswordInput {...common} value={value} onChange={(e) => set(e.currentTarget.value)} autoComplete="off" />
  return <TextInput {...common} value={value} onChange={(e) => set(e.currentTarget.value)} />
}

const toggle = (xs: number[], id: number) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id])

/** Settings, then who it is for, then the permission screen. Nothing is sent until the last step. */
export function InstallFlow({ item, onDone }: { item: CatalogItem; onDone: () => void }) {
  const ids = item.permissions.map((p) => p.id)
  const hasSettings = item.settings.length > 0
  const [step, setStep] = useState(hasSettings ? 1 : 2)
  const [vals, setVals] = useState<Vals>({})
  const [kidIds, setKidIds] = useState<number[]>([])
  const [choreIds, setChoreIds] = useState<number[]>([])
  const [widgetIds, setWidgetIds] = useState<number[]>([])
  const kidsQ = useKids()
  const kids = kidsQ.data ?? []
  const chores = useLibrary().data ?? []
  const install = useInstallIntegration()
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => head.current?.focus(), [step])

  const name = (k: { full_name: string | null; username: string }) => k.full_name || k.username
  const settingsOk = item.settings.every((f) => !f.required || (vals[f.key] ?? '').trim() !== '')
  const wantsChores = ids.includes('chores.complete')
  const wantsWidgets = ids.includes('widgets.kid')
  const back = () => (step === 2 && !hasSettings ? onDone() : setStep(step - 1))

  const connect = () => {
    if (install.isPending) return
    const settings = Object.fromEntries(
      item.settings.filter((f) => (vals[f.key] ?? '') !== '').map((f) => [f.key, f.type === 'number' ? Number(vals[f.key]) : vals[f.key]]),
    )
    install.mutate(
      {
        integration_id: item.id,
        settings,
        kid_ids: kidIds,
        chore_ids: wantsChores ? choreIds : [],
        kid_widget_ids: wantsWidgets ? widgetIds.filter((id) => kidIds.includes(id)) : [],
        accepted_permissions: ids,
      },
      { onSuccess: onDone, onError: (e) => toastFail(errorText(e)) },
    )
  }

  return (
    <section className="pn-card ig-flow" aria-label={`Connect ${item.name}`}>
      <div className="ig-top">
        <span className="ig-icon" aria-hidden="true"><Icon name={item.icon} size={22} /></span>
        <div className="pn-t2">{item.name}<small>Step {step - (hasSettings ? 0 : 1)} of {hasSettings ? 3 : 2}</small></div>
      </div>
      {step === 1 && (
        <form className="pn-form" onSubmit={(e) => { e.preventDefault(); if (settingsOk) setStep(2) }}>
          <h3 className="ig-h" tabIndex={-1} ref={head}>Set up {item.name}</h3>
          {item.settings.map((f) => (
            <Field key={f.key} f={f} value={vals[f.key] ?? ''} set={(v) => setVals({ ...vals, [f.key]: v })} />
          ))}
          <div className="pn-row">
            <button type="button" className="p-btn" onClick={onDone}>Cancel</button>
            <button type="submit" className="p-btn" data-variant="accent" disabled={!settingsOk}>Next</button>
          </div>
        </form>
      )}
      {step === 2 && (
        <form className="pn-form" onSubmit={(e) => { e.preventDefault(); if (kidIds.length) setStep(3) }}>
          <h3 className="ig-h" tabIndex={-1} ref={head}>Who is this for?</h3>
          {kidsQ.isPending && <Skeleton rows={2} />}
          {kidsQ.isSuccess && !kids.length && <p className="pn-help">Add a kid first.</p>}
          <Checkbox.Group value={kidIds.map(String)} onChange={(v) => setKidIds(v.map(Number))}>
            <div className="ig-list">{kids.map((k) => <Checkbox key={k.id} value={String(k.id)} label={name(k)} />)}</div>
          </Checkbox.Group>
          {wantsChores && (
            <Checkbox.Group label="Which chores can it check off?" value={choreIds.map(String)} onChange={(v) => setChoreIds(v.map(Number))}>
              <div className="ig-list">{chores.map((c) => <Checkbox key={c.id} value={String(c.id)} label={c.title} />)}</div>
            </Checkbox.Group>
          )}
          {wantsWidgets && kids.filter((k) => kidIds.includes(k.id)).map((k) => (
            <Switch key={k.id} className="pn-sw" label={`Show cards on ${name(k)}'s screens`} checked={widgetIds.includes(k.id)} onChange={() => setWidgetIds(toggle(widgetIds, k.id))} />
          ))}
          <div className="pn-row">
            <button type="button" className="p-btn" onClick={back}>Back</button>
            <button type="submit" className="p-btn" data-variant="accent" disabled={!kidIds.length}>Next</button>
          </div>
        </form>
      )}
      {step === 3 && (
        <div className="pn-form">
          <h3 className="ig-h" tabIndex={-1} ref={head}>{item.name} will be able to:</h3>
          <PermissionList perms={item.permissions} />
          <p className="ig-meta"><Icon name="public" size={16} />Data goes to: {item.domain}</p>
          <p className="ig-meta"><Icon name="code" size={16} />By {item.developer}</p>
          <div className="pn-row">
            <button type="button" className="p-btn" onClick={back} disabled={install.isPending}>Back</button>
            <button type="button" className="p-btn" data-variant="accent" data-loading={install.isPending || undefined} disabled={install.isPending} onClick={connect}>
              Allow &amp; connect
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
