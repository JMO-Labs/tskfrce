import { useState } from 'react'
import { useDisclosure } from '@mantine/hooks'
import { useNetworks, usePatchNetwork, type NetworkRow } from '@/v2/hooks/useNetworks'
import { toastFail } from '@/v2/notify'
import { Icon } from '@/v2/parent/Icon'
import { ConfirmDelete } from './ConfirmDelete'
import { Setr, Sw } from './FamilyRows'
import { PaneCard } from './PaneParts'
import { ago } from './settingsMeta'

function NetworkLine({ n }: { n: NetworkRow }) {
  const patch = usePatchNetwork()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [confirm, { open, close }] = useDisclosure(false)
  const save = (p: { custom_label?: string | null; enforce?: boolean }) => patch.mutate({ id: n.id, ...p }, { onError: toastFail })
  const finish = () => {
    setEditing(false)
    const v = text.trim()
    if (v !== n.label) save({ custom_label: v || null })
  }
  return (
    <>
      <Setr label={editing ? 'Name' : n.label}>
        {editing ? (
          <input
            className="pk-input"
            aria-label="Network name"
            autoFocus
            maxLength={40}
            value={text}
            placeholder={n.auto_label}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish()
              else if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <button type="button" className="p-btn" aria-label={`Rename ${n.label}`} onClick={() => { setText(n.label); setEditing(true) }}>
            <Icon name="edit" size={16} />
          </button>
        )}
        <Sw
          label={`Enforce here on ${n.label}`}
          checked={n.enforce}
          onChange={(v) => (v ? save({ enforce: true }) : open())}
        />
      </Setr>
      <div className="ch-lb" style={{ opacity: 0.7, fontSize: 12 }}>
        {n.subnet} · last seen {ago(n.last_seen)}
      </div>
      <ConfirmDelete
        opened={confirm}
        title="Stop enforcing here?"
        body={`Devices on ${n.label} won't be paused.`}
        confirmLabel="Turn off"
        onConfirm={() => save({ enforce: false })}
        onClose={close}
      />
    </>
  )
}

/** Settings → Networks: every network the box is on. Hidden when there is only one. */
export function NetworksCard() {
  const q = useNetworks()
  const rows = Array.isArray(q.data) ? q.data : []
  if (rows.length < 2) return null
  return (
    <PaneCard icon="lan" title="Networks">
      <div className="ch-setl">
        {rows.map((n) => <NetworkLine key={n.id} n={n} />)}
      </div>
    </PaneCard>
  )
}
