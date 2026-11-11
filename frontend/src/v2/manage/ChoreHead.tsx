import { DetailHeader } from '@/v2/parent/DetailHeader'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import type { ChoreType } from '@/v2/types'
import { UNIVERSAL_NOTES } from './choreMeta'

interface Props {
  title: string
  sub: string
  type?: ChoreType
  /** Saved chore only: Duplicate and Delete. */
  onDuplicate?: () => void
  onDelete?: () => void
  onEditType: () => void
}

/** Chore header: type tile, name, one summary line and the "…" menu. With a type, the tile is a button whose pop-over holds the notes kids can send and "Edit <type> type" (tskfrce#9, mockup option A). */
export function ChoreHead({ title, sub, type, onDuplicate, onDelete, onEditType }: Props) {
  const glyph = <Icon name={type?.glyph ?? 'task_alt'} size={26} />
  const media = type ? (
    <InfoPop
      label={`Notes kids can send, ${type.name}`}
      width={280}
      target={
        <button type="button" className="pk-tile pk-tile-lg ch-tile-btn" aria-label={`${type.name} type, notes kids can send`} title="Notes kids can send">
          {glyph}
          <span className="ch-tile-badge"><Icon name="chat_bubble" size={12} /></span>
        </button>
      }
    >
      <p className="ch-pop-p"><b className="ch-ink">Notes kids can send</b><br />{`From the ${type.name} type. Kids pick one when they're stuck.`}</p>
      <div className="ch-notes">
        {type.notes.map((n) => <span key={n.id} className="pk-np">{n.label}</span>)}
        {UNIVERSAL_NOTES.map((n) => <span key={n.label} className="pk-np" data-universal>{n.label}</span>)}
      </div>
      <hr className="p-pk-div" />
      <button type="button" className="p-mi ch-edit" onClick={onEditType}><Icon name="edit" size={16} />{`Edit ${type.name} type`}</button>
    </InfoPop>
  ) : <span className="pk-tile pk-tile-lg">{glyph}</span>
  return (
    <DetailHeader
      media={media}
      title={title}
      sub={sub}
      menu={onDuplicate && onDelete ? [
        { label: 'Duplicate', icon: 'content_copy', onClick: onDuplicate },
        { label: 'Delete chore', icon: 'delete', tone: 'red', divider: true, onClick: onDelete },
      ] : undefined}
    />
  )
}
