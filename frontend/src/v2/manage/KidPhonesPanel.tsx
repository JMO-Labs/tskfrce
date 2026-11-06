import { useEffect, useRef, useState } from 'react'
import { daysAgo } from '@/v2/clockText'
import { EnrollQr } from '@/v2/components/EnrollQr'
import { useEnrollCode } from '@/v2/hooks/useEnroll'
import { useKidPhones, useRemoveKidPhone } from '@/v2/hooks/useKidPhones'
import { toastFail, toastOk } from '@/v2/notify'
import { Icon } from '@/v2/parent/Icon'
import type { Kid } from '@/v2/types'
import type { EnrollCode, KidPhone } from '@/v2/types/enroll'
import { ConfirmDelete } from './ConfirmDelete'
import { nameOf } from './choreMeta'

const ago = (iso: string) => {
  const n = daysAgo(iso)
  return n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`
}
const added = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Parent view of a kid's signed-in phones: list, add by QR, remove. */
export function KidPhonesPanel({ kid }: { kid: Kid }) {
  const [code, setCode] = useState<EnrollCode>() // kept across "New code" so the QR doesn't jump
  const phones = useKidPhones(kid.id, code ? 5000 : false) // while a QR is up, watch for the phone signing in
  const remove = useRemoveKidPhone()
  const enroll = useEnrollCode()
  const [asking, setAsking] = useState<KidPhone>()
  const name = nameOf(kid)
  const make = () => enroll.mutate(kid.id, { onSuccess: setCode, onError: toastFail })
  const rows = Array.isArray(phones.data) ? phones.data : []
  const seen = useRef<number>(undefined)
  useEffect(() => {
    if (!phones.isSuccess) return
    if (code && seen.current !== undefined && rows.length > seen.current) {
      setCode(undefined) // the scan landed: close the QR
      toastOk('Phone added')
    }
    seen.current = rows.length
  }, [phones.isSuccess, rows.length, code])
  return (
    <section className="pk-panel pk-span" aria-label="Phones and tablets">
      <h3>
        <Icon name="smartphone" size={18} />
        Phones and tablets
      </h3>
      {phones.isSuccess && rows.length === 0 && <p className="pk-hint">No phones yet. Not every kid has one, and that&apos;s fine.</p>}
      {rows.map((p) => (
        <div key={p.id} className="pk-line">
          <span className="pk-card-t">
            <b>{p.label}</b>
            <small>{`Added ${added(p.created_at)} · last used ${ago(p.last_seen_at)}`}</small>
          </span>
          <button type="button" className="p-btn" aria-label={`Remove ${p.label}`} onClick={() => setAsking(p)}>
            Remove
          </button>
        </div>
      ))}
      {code ? (
        <EnrollQr kid={kid} code={code} busy={enroll.isPending} onNew={make} />
      ) : (
        <div className="pk-actions">
          <button type="button" className="p-btn" disabled={enroll.isPending} onClick={make}>
            <Icon name="add" />
            Add a phone
          </button>
        </div>
      )}
      <ConfirmDelete
        opened={!!asking}
        title={`Remove ${name}'s ${asking?.label ?? 'phone'}?`}
        body={`It signs out right away. Scan a new code to add it back.${rows.length > 1 ? ` ${name}'s other phones will be asked to reconnect alerts.` : ''}`}
        confirmLabel="Remove"
        onConfirm={() => asking && remove.mutate({ kidId: kid.id, phoneId: asking.id }, { onSuccess: () => toastOk('Phone removed'), onError: toastFail })}
        onClose={() => setAsking(undefined)}
      />
    </section>
  )
}
