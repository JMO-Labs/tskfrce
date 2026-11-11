import { useState } from 'react'
import { Icon } from '../parent/Icon'
import { MoreMenu } from '../parent/MoreMenu'
import { useFamily } from '../hooks/useFamily'
import type { NeedsItem } from '../types'
import type { NeedsActions } from './needsActions'
import { PenaltySheet } from './PenaltySheet'

/** Approve + "…" (Send back, Reply) for a chore row that waits on a parent. A sibling of the row button, never inside it. */
export function WaitingActions({ item, name, act }: { item: NeedsItem; name: string; act: NeedsActions }) {
  const [sending, setSending] = useState(false)
  const [pen, setPen] = useState(false)
  const penalties = !!useFamily().data?.penalties_enabled
  return (
    <>
      <div className="pt-wact">
        <button
          type="button"
          className="p-btn"
          data-variant="accent"
          disabled={!!act.busy}
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
            { label: 'Give penalty', icon: 'gavel', takesFocus: true, hidden: !penalties || !item.kid_id, onClick: () => setPen(true) },
          ]}
        />
      </div>
      {pen && item.kid_id && <PenaltySheet kidIds={[item.kid_id]} from={{ chore_run_id: item.id }} onClose={() => setPen(false)} />}
      {sending && <SendBackBox item={item} act={act} onClose={() => setSending(false)} />}
    </>
  )
}

/** Note box + Send back / Cancel under a row. Stays open with its text if the request fails. */
export function SendBackBox({ item, act, onClose }: { item: NeedsItem; act: NeedsActions; onClose: () => void }) {
  const [note, setNote] = useState('')
  const busy = !!act.busy
  const send = async () => {
    if (await act.sendBack(item.id, note.trim())) onClose()
  }
  return (
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
      <button type="button" className="p-btn" onClick={onClose}>
        Cancel
      </button>
    </div>
  )
}
