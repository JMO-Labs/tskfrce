import type { ReactNode } from 'react'
import type { ChipTone } from './Chip'
import { Icon } from './Icon'
import { InfoPop } from './InfoPop'
import { MoreMenu } from './MoreMenu'
import type { MenuItem } from './MoreMenu'

/** One item that needs the parent: type icon, title, one main button, "…" menu, optional inline box below. */
export function ActionRow({ icon, iconTone, iconLabel, iconHelp, title, sub, main, menu, menuLabel = 'More', menuInfo, children }: {
  icon: string; iconTone?: ChipTone; iconLabel: string; iconHelp?: ReactNode; title: ReactNode; sub?: ReactNode
  main?: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean; /** outline instead of the accent fill */ plain?: boolean }
  menu?: MenuItem[]; menuLabel?: string; /** info lines shown above the menu items */ menuInfo?: string[]; children?: ReactNode
}) {
  const ty = iconHelp
    ? <button type="button" className="p-arow-ty" data-tone={iconTone} aria-label={iconLabel}><Icon name={icon} size={18} /></button>
    : <span className="p-arow-ty" data-tone={iconTone} role="img" aria-label={iconLabel}><Icon name={icon} size={18} /></span>
  return (
    <div>
      <div className="p-arow">
        {iconHelp ? <InfoPop label={iconLabel} target={ty}>{iconHelp}</InfoPop> : ty}
        <div className="p-arow-t">{title}{sub && <small>{sub}</small>}</div>
        <div className="p-arow-acts">
          {main && (
            <button type="button" className="p-btn" data-variant={main.plain ? undefined : 'accent'} onClick={main.onClick} disabled={main.disabled} aria-busy={main.busy} data-loading={main.busy || undefined}>{main.label}</button>
          )}
          {!!menu?.length && <MoreMenu label={menuLabel} items={menu} info={menuInfo} />}
        </div>
      </div>
      {children}
    </div>
  )
}
