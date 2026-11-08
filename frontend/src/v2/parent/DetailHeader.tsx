import type { ReactNode } from 'react'
import { Chip } from './Chip'
import type { ChipTone } from './Chip'
import { Icon } from './Icon'
import { InfoPop } from './InfoPop'
import { MoreMenu } from './MoreMenu'
import type { MenuItem } from './MoreMenu'

export interface StatusChip { tone: ChipTone; icon: string; label: string; pop?: ReactNode }

/** Header of a detail page: media, title, chips, one main action and the "…" menu. */
export function DetailHeader({ media, title, sub, chips, status, main, menu, menuLabel = 'More', menuId }: {
  media: ReactNode; title: string; sub?: ReactNode; chips?: ReactNode; status?: StatusChip
  main?: ReactNode; menu?: MenuItem[]; menuLabel?: string; menuId?: string
}) {
  return (
    <header className="p-dhead">
      {media}
      <div className="p-dhead-meta">
        <h2>{title}</h2>
        {sub && <div className="p-dhead-sub">{sub}</div>}
        {(status || chips) && (
          <div className="p-dhead-chips">
            {status && (status.pop ? (
              <InfoPop label={status.label} target={<button type="button" className="p-chip" data-tone={status.tone}><Icon name={status.icon} size={16} />{status.label}</button>}>{status.pop}</InfoPop>
            ) : <Chip tone={status.tone} icon={status.icon}>{status.label}</Chip>)}
            {chips}
          </div>
        )}
      </div>
      {(main || menu?.length) && (
        <div className="p-dhead-act">
          {main}
          {!!menu?.length && <MoreMenu label={menuLabel} items={menu} id={menuId} />}
        </div>
      )}
    </header>
  )
}
