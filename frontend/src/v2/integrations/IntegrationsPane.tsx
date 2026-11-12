import { useState } from 'react'
import { useCatalog, useInstalls } from '@/v2/hooks/useIntegrations'
import { Icon } from '@/v2/parent/Icon'
import { EmptyState, ErrorPanel, Skeleton } from '@/v2/parent/states'
import { PaneHead } from '../manage/PaneParts'
import { InstallFlow } from './InstallFlow'
import { IntegrationDetail } from './IntegrationDetail'
import { LocalKeyForm } from './LocalKeyForm'
import { usePushUrl } from './pushUrl'
import type { CatalogItem, InstallOut, InstallStatus } from './types'
import { useFeatureOpen } from '@/v2/eval/featureMap'

const STATUS: Record<string, [string, string]> = {
  active: ['Active', 'acc'],
  paused: ['Paused', 'amb'],
}

const chip = (s: InstallStatus) => STATUS[s] ?? ['Turned off', 'grey']

function InstallRow({ i, onOpen }: { i: InstallOut; onOpen: (id: number) => void }) {
  const [label, tone] = chip(i.status)
  return (
    <button type="button" className="pn-par ig-row" aria-label={`Open ${i.name}`} onClick={() => onOpen(i.id)}>
      <span className="ig-icon" aria-hidden="true"><Icon name={i.icon} size={20} /></span>
      <div className="pn-t2">{i.name}{i.key_prefix && <small>{i.key_prefix}…</small>}</div>
      <span className="p-chip" data-tone={tone}>{label}</span>
      <Icon name="chevron_right" size={20} />
    </button>
  )
}

/** Settings → Integrations: what is connected, and what can be added. */
export function IntegrationsPane() {
  useFeatureOpen('integrations')
  const installs = useInstalls()
  const catalog = useCatalog()
  const [adding, setAdding] = useState<CatalogItem | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const { url, filled } = usePushUrl()
  const [making, setMaking] = useState(false)
  const apps = installs.data?.filter((i) => i.source !== 'local') ?? []
  const keys = installs.data?.filter((i) => i.source === 'local') ?? []
  const addable = catalog.data?.filter((c) => !c.installed) ?? []
  return (
    <div className="pn">
      <PaneHead title="Integrations" sub="Connect other apps to your family." />
      {open !== null ? (
        <IntegrationDetail key={open} id={open} onClose={() => setOpen(null)} />
      ) : making ? (
        <LocalKeyForm onDone={() => setMaking(false)} />
      ) : adding ? (
        <InstallFlow key={adding.id} item={adding} onDone={() => setAdding(null)} />
      ) : (
        <>
          {installs.isPending && <Skeleton rows={2} />}
          {installs.isError && <ErrorPanel kind="unreachable" error={installs.error} onRetry={() => installs.refetch()} />}
          {!!apps.length && (
            <section className="pn-card" aria-label="Connected">
              <h3 className="pn-cap ig-cap">Connected</h3>
              {apps.map((i) => <InstallRow key={i.id} i={i} onOpen={setOpen} />)}
            </section>
          )}
          {catalog.isPending && <Skeleton rows={2} />}
          {catalog.isError && <ErrorPanel kind="unreachable" error={catalog.error} onRetry={() => catalog.refetch()} />}
          {catalog.data && (
            <section className="pn-card" aria-label="Add">
              <h3 className="pn-cap ig-cap">Add</h3>
              {addable.length === 0 && <EmptyState icon="extension" title="Nothing to add yet." body="New apps show up here when they are ready." />}
              {addable.map((c) => (
                <div key={c.id} className="pn-par">
                  <span className="ig-icon" aria-hidden="true"><Icon name={c.icon} size={20} /></span>
                  <div className="pn-t2">{c.name}<small>{c.description}</small></div>
                  <button type="button" className="p-btn" aria-label={`Add ${c.name}`} onClick={() => setAdding(c)}>Add</button>
                </div>
              ))}
            </section>
          )}
          {installs.isSuccess && (
            <section className="pn-card" aria-label="Home network keys">
              <div className="ig-cap-row">
                <h3 className="pn-cap ig-cap">Home network keys</h3>
                <button type="button" className="p-btn" onClick={() => setMaking(true)}>
                  <Icon name="add" size={16} />
                  Create key
                </button>
              </div>
              <p className="pn-help ig-scope">
                Let Home Assistant or a script on your home network send actions. Pushes only work from inside your home at
                {' '}<code className="ig-code">{url}</code>.{!filled && ' They are refused through the public address.'}
              </p>
              {keys.map((i) => <InstallRow key={i.id} i={i} onOpen={setOpen} />)}
            </section>
          )}
        </>
      )}
    </div>
  )
}
