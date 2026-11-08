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

/** Chore header: type tile, name, one summary line, the type chip (its pop-over holds the notes kids can send) and the "…" menu. */
export function ChoreHead({ title, sub, type, onDuplicate, onDelete, onEditType }: Props) {
  const chip = type && (
    <InfoPop
      label={`Notes kids can send, ${type.name}`}
      width={280}
      target={
        <button type="button" className="kd-pill ch-chip">
          <Icon name={type.glyph} size={16} />
          {type.name}
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
  )
  return (
    <DetailHeader
      media={<span className="pk-tile pk-tile-lg"><Icon name={type?.glyph ?? 'task_alt'} size={30} /></span>}
      title={title}
      sub={sub}
      chips={chip}
      menu={onDuplicate && onDelete ? [
        { label: 'Duplicate', icon: 'content_copy', onClick: onDuplicate },
        { label: 'Delete chore', icon: 'delete', tone: 'red', divider: true, onClick: onDelete },
      ] : undefined}
    />
  )
}
