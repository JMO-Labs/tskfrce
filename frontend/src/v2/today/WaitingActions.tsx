import { useState } from 'react'
import { Icon } from '../parent/Icon'
import { MoreMenu } from '../parent/MoreMenu'
import type { NeedsItem } from '../types'
import type { NeedsActions } from './needsActions'

/** Approve + "…" (Send back, Reply) for a chore row that waits on a parent. A sibling of the row button, never inside it. */
export function WaitingActions({ item, name, act }: { item: NeedsItem; name: string; act: NeedsActions }) {
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const busy = !!act.busy
  const send = async () => {
    if (await act.sendBack(item.id, note.trim())) (setSending(false), setNote(''))
  }
  return (
    <>
      <div className="pt-wact">
        <button
          type="button"
          className="p-btn"
          data-variant="accent"
          disabled={busy}
          data-loading={act.busy === `a${item.type}${item.id}` || undefined}
          onClick={() => act.approve(item)}
        >
          Approve
        </button>
        <MoreMenu
          label={`More for ${name}`}
          items={[
            {
              label: 'Send back',
              icon: 'undo',
              onClick: () => setSending(true),
            },
            { label: 'Reply', icon: 'chat', onClick: () => act.reply(item) },
          ]}
        />
      </div>
      {sending && (
        <div className="pt-wsend">
          <input
            className="p-needs-note"
            aria-label="Note for sending back"
            placeholder={`What should ${item.kid_name ?? 'they'} fix?`}
            value={note}
            maxLength={500}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className="p-btn" disabled={!note.trim() || busy} data-loading={act.busy === `s${item.id}` || undefined} onClick={send}>
            <Icon name="undo" size={16} />
            Send back
          </button>
          <button type="button" className="p-btn" onClick={() => (setSending(false), setNote(''))}>
            Cancel
          </button>
        </div>
      )}
    </>
  )
}
