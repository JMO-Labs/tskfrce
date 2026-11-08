import type { InboxItem } from '../hooks/useInbox'
import { openChat } from '../chat/dock'
import type { ChipTone } from '../parent/Chip'
import { ActionRow } from '../parent/ActionRow'
import type { MenuItem } from '../parent/MoreMenu'
import { when, isNeedsYou, severity, type Tone } from './bellRules'

type Props = {
  n: InboxItem
  /** buttons only for today's items and ones still waiting on a parent */
  live: boolean
  busy: boolean
  /** the Send back note box is open for this item */
  sending: boolean
  note: string
  onNote: (v: string) => void
  onApprove: () => void
  /** first call opens the note box, the next one sends it */
  onSendBack: () => void
  onDecide: (yes: boolean) => void
  onDismiss: () => void
  onLock: () => void
  /** tap on the row text */
  onOpen: () => void
  /** mark read, close the bell and go to `to` (null: just close); resolves once the page has changed */
  go: (to: string | null) => Promise<unknown>
}

const TONE: Record<Tone, ChipTone | undefined> = { hi: 'red', md: 'amb', lv: 'lav', ok: undefined }
const LABEL: Record<string, string> = {
  chore_submitted: 'Chore done', integration_done: 'Chore done', chore_note: 'Note', redemption_request: 'Reward request',
  new_device: 'New device', device_resisting: 'Security alert', device_bypass: 'Security alert', workaround_try: 'Security alert',
  password_guess: 'Security alert', box_offline: 'Home box', boost: 'Happy Hour',
}

/** One inbox row (v3): one main button; Send back, Decline, Ask, Dismiss live in the "..." menu. */
export function InboxRow({ n, live, busy, sending, note, onNote, onApprove, onSendBack, onDecide, onDismiss, onLock, onOpen, go }: Props) {
  const needs = isNeedsYou(n)
  const device = n.device_id ? `/devices?item=${n.device_id}` : '/devices'
  const reply = () => void go(`/?chore=${n.run_id}`).then(() => openChat('chore', String(n.run_id)))
  const ask = () => void go(null).then(() => openChat('private', String(n.kid_id)))
  let main: { label: string; onClick: () => void; plain?: boolean } | undefined
  let menu: MenuItem[] = []
  if (live) {
    if (needs && (n.kind === 'chore_submitted' || n.kind === 'integration_done')) {
      main = { label: 'Approve', onClick: onApprove }
      menu = [{ label: 'Send back', icon: 'undo', onClick: onSendBack, takesFocus: true }, { label: 'Reply', icon: 'chat', onClick: reply, hidden: !n.run_id }]
    } else if (needs && n.kind === 'redemption_request') {
      main = { label: 'Approve', onClick: () => onDecide(true) }
      menu = [{ label: 'Decline', icon: 'close', onClick: () => onDecide(false) }]
    } else if (needs && n.kind === 'chore_note' && n.run_id) main = { label: 'Reply', onClick: reply }
    else if (n.kind === 'new_device' && n.pending) main = { label: "Who's this?", onClick: () => void go(device), plain: true }
    else if (n.kind === 'device_resisting' || n.kind === 'device_bypass' || n.kind === 'workaround_try') {
      main = { label: 'View', onClick: () => void go(device), plain: true }
      menu = [{ label: `Ask ${n.kid_name ?? 'kid'}`, icon: 'chat', onClick: ask, hidden: !n.kid_id },
        { label: `Lock all ${n.kid_name ?? 'kid'}'s devices`, icon: 'lock', tone: 'red', onClick: onLock, hidden: !n.kid_id },
      ]
    } else if (n.kind === 'password_guess') main = { label: 'Change password', onClick: () => void go('/settings?section=parents#password'), plain: true }
    else if (n.kind === 'box_offline') main = { label: 'View', onClick: () => void go('/devices'), plain: true }
    else if (n.kind === 'boost') menu = [{ label: 'See Happy Hour', icon: 'bolt', onClick: () => void go('/') }]
  }
  menu = menu.map((m) => ({ ...m, disabled: busy }))
  menu.push({ label: 'Dismiss', icon: 'close', onClick: onDismiss, divider: menu.some((m) => !m.hidden) })
  const sev = severity(n)
  const sub = [n.body, n.points ? `+${n.points} pts` : '', when(n.created_at)].filter(Boolean).join(' · ')
  return (
    <ActionRow
      icon={sev.name}
      iconTone={TONE[sev.tone]}
      iconLabel={LABEL[n.kind] ?? 'Notification'}
      title={
        <button type="button" className="p-bell-text" onClick={onOpen}>
          {!n.read && <i className="p-bell-ud" aria-label="Unread" />}
          {n.title}
        </button>
      }
      sub={sub}
      main={main && { ...main, busy, disabled: busy }}
      menu={menu}
      menuLabel={`More for ${n.title}`}
    >
      {sending && (
        <div className="p-arow p-bell-sendrow">
          <input className="p-bell-note" aria-label="Note for sending back" placeholder="What should they fix?" value={note} maxLength={500} autoFocus onChange={(e) => onNote(e.target.value)} />
          <button type="button" className="p-btn" data-variant="accent" disabled={busy || !note.trim()} onClick={onSendBack}>Send</button>
        </div>
      )}
    </ActionRow>
  )
}
