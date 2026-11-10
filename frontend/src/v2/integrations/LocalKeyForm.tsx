import { useEffect, useRef, useState } from 'react'
import { Checkbox, Modal, Switch, TextInput, VisuallyHidden } from '@mantine/core'
import { errorText } from '@/v2/api'
import { useLibrary } from '@/v2/hooks/useChores'
import { useCreateLocalKey, useLocalPermissions } from '@/v2/hooks/useIntegrations'
import { useKids } from '@/v2/hooks/useKids'
import { toastFail } from '@/v2/notify'
import { Icon } from '@/v2/parent/Icon'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { PermissionList, trustLine } from './PermissionList'
import { usePushUrl } from './pushUrl'

interface Sample { kid: number; chore: number }

const curl = (url: string, token: string, s: Sample) =>
  `curl -X POST ${url} \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '${action(s)}'`
const action = (s: Sample) => `{"actions":[{"type":"chore.complete","kid_id":${s.kid},"chore_id":${s.chore},"idempotency_key":"my-first-push"}]}`
const ha = (url: string, token: string, s: Sample) =>
  `rest_command:\n  tsk_push:\n    url: "${url}"\n    method: POST\n    headers:\n      Authorization: "Bearer ${token}"\n      Content-Type: application/json\n    payload: '${action(s)}'`

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

/** Shown once, in a dialog that only Done can close. The token lives in this component's state and nowhere else. */
function TokenDialog({ token, sample, onDone }: { token: string; sample: Sample; onDone: () => void }) {
  const { url, filled } = usePushUrl()
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const copy = async () => {
    field.current?.select()
    try {
      // the clipboard API needs https; the home network address is plain http, so fall back to the old way
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(token)
      else if (!document.execCommand('copy')) throw new Error('copy')
      setCopied(true)
    } catch {
      toastFail('Could not copy. Select the key and copy it by hand.')
    }
  }
  return (
    <Modal
      opened
      onClose={onDone}
      title="Your new key"
      centered
      size="lg"
      zIndex={400}
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      styles={{ title: { fontWeight: 700, color: 'var(--p-ink)' } }}
    >
      <div className="ig-flow">
        <div className="ig-banner" data-tone="amb">
          <Icon name="key" size={20} />
          <span>Copy this now. You won&apos;t see it again.</span>
        </div>
        <div className="ig-copy">
          <TextInput
            ref={field}
            className="ig-token"
            aria-label="New key"
            readOnly
            value={token}
            onFocus={(e) => e.currentTarget.select()}
            styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }}
          />
          <button type="button" className="p-btn" data-variant="accent" onClick={copy} autoFocus>
            <Icon name={copied ? 'check' : 'content_copy'} size={16} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <VisuallyHidden role="status">{copied ? 'Key copied to the clipboard.' : ''}</VisuallyHidden>
        <p className="pn-help ig-scope">
          Send pushes from your home network to <code className="ig-code">{url}</code>.
          {filled ? ' It only works from inside your home.' : <> Replace <code className="ig-code">&lt;box&gt;</code> with this server&apos;s home network address. Through the public address they are refused.</>}
        </p>
        <h4 className="pn-cap ig-cap">curl</h4>
        <pre className="ig-pre" tabIndex={0} aria-label="curl example">{curl(url, token, sample)}</pre>
        <h4 className="pn-cap ig-cap">Home Assistant</h4>
        <pre className="ig-pre" tabIndex={0} aria-label="Home Assistant example">{ha(url, token, sample)}</pre>
        <div className="pn-row">
          <button type="button" className="p-btn" data-variant="accent" onClick={onDone}>Done</button>
        </div>
      </div>
    </Modal>
  )
}

/** Name, what the key may do, for which kids and chores. The token appears once after Create. */
export function LocalKeyForm({ onDone }: { onDone: () => void }) {
  const permsQ = useLocalPermissions()
  const kidsQ = useKids()
  const chores = useLibrary().data ?? []
  const create = useCreateLocalKey()
  const [name, setName] = useState('')
  const [perms, setPerms] = useState<string[]>([])
  const [kidIds, setKidIds] = useState<number[]>([])
  const [choreIds, setChoreIds] = useState<number[]>([])
  const [trusted, setTrusted] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => head.current?.focus(), [])

  const kids = kidsQ.data ?? []
  const wantsChores = perms.includes('chores.complete')
  const ok = name.trim() !== '' && perms.length > 0 && kidIds.length > 0
  const kidName = (k: { full_name: string | null; username: string }) => k.full_name || k.username

  const submit = () => {
    if (!ok || create.isPending) return
    create.mutate(
      { name: name.trim(), permissions: perms, kid_ids: kidIds, chore_ids: wantsChores ? choreIds : [], trusted },
      {
        onSuccess: (r) => (setToken(r.token), create.reset()),
        onError: (e) => toastFail(errorText(e)),
      },
    )
  }

  return (
    <section className="pn-card ig-flow" aria-label="Create a home network key">
      <div className="ig-top">
        <span className="ig-icon" aria-hidden="true"><Icon name="home" size={22} /></span>
        <div className="pn-t2">Home network key<small>For Home Assistant and scripts on your home network</small></div>
      </div>
      <form className="pn-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <h3 className="ig-h" tabIndex={-1} ref={head}>Create a key</h3>
        <TextInput label="Name" placeholder="Home Assistant" maxLength={40} required withAsterisk value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <div>
          <h4 className="pn-cap ig-cap">This key can</h4>
          {permsQ.isPending && <Skeleton rows={3} />}
          {permsQ.isError && <ErrorPanel kind="unreachable" error={permsQ.error} onRetry={() => permsQ.refetch()} />}
          {permsQ.data && <PermissionList perms={permsQ.data} picked={perms} onToggle={(id) => setPerms(toggle(perms, id))} />}
        </div>
        <Checkbox.Group label="Which kids is it for?" required withAsterisk value={kidIds.map(String)} onChange={(v) => setKidIds(v.map(Number))}>
          <div className="ig-list">
            {kidsQ.isSuccess && !kids.length && <p className="pn-help">Add a kid first.</p>}
            {kids.map((k) => <Checkbox key={k.id} value={String(k.id)} label={kidName(k)} />)}
          </div>
        </Checkbox.Group>
        {wantsChores && (
          <Checkbox.Group label="Which chores can it check off?" value={choreIds.map(String)} onChange={(v) => setChoreIds(v.map(Number))}>
            <div className="ig-list">{chores.map((c) => <Checkbox key={c.id} value={String(c.id)} label={c.title} />)}</div>
          </Checkbox.Group>
        )}
        <div className="ig-trust">
          <Switch className="pn-sw" label="Trust automatically" checked={trusted} onChange={(e) => setTrusted(e.currentTarget.checked)} aria-describedby="ig-lk-trust" />
          <p id="ig-lk-trust" className="pn-help" data-warn={trusted || undefined} aria-live="polite">{trustLine(trusted)}</p>
        </div>
        <div className="pn-row">
          <button type="button" className="p-btn" onClick={onDone} disabled={create.isPending}>Cancel</button>
          <button type="submit" className="p-btn" data-variant="accent" data-loading={create.isPending || undefined} disabled={!ok || create.isPending}>
            Create key
          </button>
        </div>
      </form>
      {token && <TokenDialog token={token} sample={{ kid: kidIds[0] ?? 1, chore: choreIds[0] ?? chores[0]?.id ?? 1 }} onDone={onDone} />}
    </section>
  )
}
