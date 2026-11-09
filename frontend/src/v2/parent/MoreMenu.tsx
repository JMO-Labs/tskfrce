import { createContext, Fragment, useContext, useState } from 'react'
import Link from 'next/link'
import { Menu } from '@mantine/core'
import { Icon } from './Icon'
import { motionProps } from './reduceMotion'

export interface MenuItem { label: string; icon: string; onClick?: () => void; href?: string; tone?: 'red'; divider?: boolean; hidden?: boolean; disabled?: boolean
  /** the item opens something that takes focus itself (an inline form): the menu must not hand focus back to "…" */
  takesFocus?: boolean }

/** Where menus render. null: body. The bell pop-over sets its own dropdown, so a click in a menu is not an outside click. */
export const MenuPortalContext = createContext<HTMLElement | null>(null)

/** The "…" menu on a header: secondary actions, Delete last in red. */
export function MoreMenu({ label, items, id, className }: { label: string; items: MenuItem[]; id?: string; className?: string }) {
  const [giveBack, setGiveBack] = useState(true)
  const target = useContext(MenuPortalContext)
  return (
    <Menu position="bottom-end" withinPortal portalProps={target ? { target } : undefined} floatingStrategy={target ? 'fixed' : undefined} transitionProps={motionProps()} returnFocus={giveBack} onOpen={() => setGiveBack(true)}>
      <Menu.Target>
        <button type="button" className={className ? `p-btn p-ib ${className}` : 'p-btn p-ib'} aria-label={label} id={id}>
          <Icon name="more_horiz" size={20} />
        </button>
      </Menu.Target>
      <Menu.Dropdown className="p-pop">
        {items.filter((i) => !i.hidden).map((i) => (
          <Fragment key={i.label}>
            {i.divider && <Menu.Divider />}
            {i.href ? (
              <Menu.Item className="p-mi" component={Link} href={i.href} color={i.tone} leftSection={<Icon name={i.icon} size={18} />}>{i.label}</Menu.Item>
            ) : (
              <Menu.Item className="p-mi" color={i.tone} disabled={i.disabled} leftSection={<Icon name={i.icon} size={18} />} onClick={() => { if (i.takesFocus) setGiveBack(false); i.onClick?.() }}>{i.label}</Menu.Item>
            )}
          </Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
