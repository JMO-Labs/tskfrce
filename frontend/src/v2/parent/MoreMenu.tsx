import { Fragment } from 'react'
import Link from 'next/link'
import { Menu } from '@mantine/core'
import { Icon } from './Icon'
import { motionProps } from './reduceMotion'

export interface MenuItem { label: string; icon: string; onClick?: () => void; href?: string; tone?: 'red'; divider?: boolean; hidden?: boolean }

/** The "…" menu on a header: secondary actions, Delete last in red. */
export function MoreMenu({ label, items, id }: { label: string; items: MenuItem[]; id?: string }) {
  return (
    <Menu position="bottom-end" withinPortal transitionProps={motionProps()}>
      <Menu.Target>
        <button type="button" className="p-btn p-ib" aria-label={label} id={id}>
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
              <Menu.Item className="p-mi" color={i.tone} leftSection={<Icon name={i.icon} size={18} />} onClick={i.onClick}>{i.label}</Menu.Item>
            )}
          </Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
