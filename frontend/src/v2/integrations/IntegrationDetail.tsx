import { useState } from 'react'
import { Switch } from '@mantine/core'
import { errorText } from '@/v2/api'
import { useInstall, useIntegrationLog, usePatchIntegration, useRemoveIntegration } from '@/v2/hooks/useIntegrations'
import { ConfirmDelete } from '@/v2/manage/ConfirmDelete'
import { toastFail, toastOk } from '@/v2/notify'
import { Icon } from '@/v2/parent/Icon'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { PermissionList } from './PermissionList'
import type { AuditRow } from './types'

const RESULT: Record<string, [string, string]> = {
  applied: ['Applied', 'acc'],
  pending: ['Waiting for you', 'lav'],
  rejected: ['Rejected', 'red'],
}

const KIND: Record<string, string> = {
  'chore.complete': 'Checked off a chore',
  'request.decide': 'Answered a request',
  'message.send': 'Sent you a message',
}

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function LogRow({ r }: { r: AuditRow }) {
  const [label, tone] = RESULT[r.result] ?? [r.result, 'grey']
  const what = [KIND[r.kind] ?? r.kind, r.kid_name, r.chore_title].filter(Boolean).join(' · ')
  return (
    <li className="ig-log">
      <div className="pn-t2">
        {what}
        <small>{r.reason ? `${r.reason} · ` : ''}{when(r.created_at)}</small>
      </div>
      <span className="p-chip" data-tone={tone}>{label}</span>
    </li>
  )
}

/** One connected integration: what it may do, the trust switch, its activity, and Remove. */
export function IntegrationDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useInstall(id)
  const log = useIntegrationLog(id)
  const patch = usePatchIntegration(id)
  const remove = useRemoveIntegration(id)
  const [asking, setAsking] = useState(false)
  const [cards, setCards] = useState<Record<number, boolean>>({}) // per-kid switch shown until the server answers
  const [trust, setTrust] = useState<{ was: boolean; val: boolean } | null>(null) // shown until the server answers
  const d = q.data

  const back = (
    <button type="button" className="p-btn ig-back" onClick={onClose}>
      <Icon name="arrow_back" size={16} />
      Integrations
    </button>
  )
  if (q.isPending) return <div className="ig-flow">{back}<Skeleton rows={3} /></div>
  if (q.isError || !d) return <div className="ig-flow">{back}<ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} /></div>

  const on = trust && trust.was === d.trusted ? trust.val : d.trusted
  const live = d.status === 'active'
  const setTrusted = (trusted: boolean) => {
    setTrust({ was: d.trusted, val: trusted })
    patch.mutate({ trusted }, { onError: (e) => (setTrust(null), toastFail(errorText(e))) })
  }

  const canKidCards = live && d.kids.length > 0 && d.permissions.some((p) => p.id === 'widgets.kid')
  const cardsOn = (k: { id: number; kid_widgets: boolean }) => cards[k.id] ?? k.kid_widgets
  const setCard = (k: { id: number; kid_widgets: boolean }, show: boolean) => {
    setCards((c) => ({ ...c, [k.id]: show }))
    const ids = d.kids.filter((x) => (x.id === k.id ? show : cardsOn(x))).map((x) => x.id)
    patch.mutate(
      { kid_widget_ids: ids },
      {
        onError: (e) => toastFail(errorText(e)),
        onSettled: () => setCards(({ [k.id]: _, ...rest }) => rest),
      },
    )
  }

  return (
    <div className="ig-flow">
      {back}
      <section className="pn-card ig-flow" aria-label={d.name}>
        <div className="ig-top">
          <span className="ig-icon" aria-hidden="true"><Icon name={d.icon} size={22} /></span>
          <h3 className="ig-h">{d.name}</h3>
        </div>
        {d.developer && <p className="ig-meta"><Icon name="code" size={16} />By {d.developer}</p>}
        {d.domain && <p className="ig-meta"><Icon name="public" size={16} />Data goes to: {d.domain}</p>}
        {d.status === 'paused' && (
          <div className="ig-banner" data-tone="amb" role="status">
            <Icon name="pause_circle" size={20} />
            <span>Paused: {d.paused_reason ?? 'it stopped answering'}</span>
            <button type="button" className="p-btn" disabled={patch.isPending} onClick={() => patch.mutate({ resume: true }, { onError: (e) => toastFail(errorText(e)) })}>
              Try again
            </button>
          </div>
        )}
        {d.status === 'revoked' && (
          <div className="ig-banner" data-tone="red" role="status">
            <Icon name="block" size={20} />
            <span>t@sk4ce turned this one off.</span>
          </div>
        )}
      </section>

      <section className="pn-card" aria-label="Permissions">
        <h3 className="pn-cap ig-cap">It can</h3>
        <PermissionList perms={d.permissions} />
      </section>

      {live && (
        <section className="pn-card ig-trust" aria-label="Trust">
          <Switch
            className="pn-sw"
            label="Trust automatically"
            checked={on}
            onChange={(e) => setTrusted(e.currentTarget.checked)}
            aria-describedby="ig-trust-line"
          />
          <p id="ig-trust-line" className="pn-help" data-warn={on || undefined} aria-live="polite">
            {on ? 'Its chore check-offs will count right away, without your OK.' : 'Its chore check-offs wait in Needs you.'}
          </p>
        </section>
      )}

      {canKidCards && (
        <section className="pn-card ig-kidcards" aria-label="Cards for kids">
          <h3 className="pn-cap ig-cap">Cards on kid screens</h3>
          <p className="pn-help">
            When this is on, the kid sees {d.name}&apos;s cards on the Me tab of their own app. Each card is labeled with
            {' '}{d.name}, and its buttons only ask you. They never do anything on their own.
          </p>
          {d.kids.map((k) => (
            <Switch
              key={k.id}
              className="pn-sw"
              label={`Show cards on ${k.name}'s screens`}
              checked={cardsOn(k)}
              onChange={(e) => setCard(k, e.currentTarget.checked)}
            />
          ))}
        </section>
      )}

      {(d.kids.length > 0 || d.chores.length > 0) && (
        <section className="pn-card" aria-label="Linked">
          {d.kids.length > 0 && (
            <>
              <h3 className="pn-cap ig-cap">Kids</h3>
              <ul className="ig-tags">{d.kids.map((k) => <li key={k.id} className="p-chip" data-tone="grey">{k.name}</li>)}</ul>
            </>
          )}
          {d.chores.length > 0 && (
            <>
              <h3 className="pn-cap ig-cap">Chores it can check off</h3>
              <ul className="ig-tags">{d.chores.map((c) => <li key={c.id} className="p-chip" data-tone="grey">{c.title}</li>)}</ul>
            </>
          )}
        </section>
      )}

      <section className="pn-card" aria-label="Activity">
        <h3 className="pn-cap ig-cap">Activity</h3>
        {log.isPending && <Skeleton rows={2} />}
        {log.isError && <ErrorPanel kind="unreachable" error={log.error} onRetry={() => log.refetch()} />}
        {log.data?.length === 0 && <p className="pn-help ig-none">Nothing yet.</p>}
        {!!log.data?.length && <ul className="ig-logs">{log.data.map((r, i) => <LogRow key={i} r={r} />)}</ul>}
      </section>

      <div className="pn-row">
        <button type="button" className="p-btn" data-variant="red" disabled={remove.isPending} onClick={() => setAsking(true)}>
          <Icon name="delete" size={16} />
          {remove.isPending ? 'Removing…' : 'Remove'}
        </button>
      </div>
      <ConfirmDelete
        opened={asking}
        title="Remove integration"
        body={`Remove ${d.name}? It stops right away. Its rewards and cards go away. Its history stays.`}
        confirmLabel="Remove"
        onClose={() => setAsking(false)}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => (toastOk(`${d.name} removed`), onClose()), onError: (e) => toastFail(errorText(e)) })}
      />
    </div>
  )
}
