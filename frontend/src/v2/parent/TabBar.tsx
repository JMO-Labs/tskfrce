import Link from 'next/link'
import { useRouter } from 'next/router'
import { useThreads } from '@/v2/hooks/useChat'
import { Icon } from './Icon'

interface TabItem {
  href: string
  label: string
  icon: string
  badge?: number
}

/** Settings is reached from More on a phone; the notifications page hangs off Today ("‹ Today"). */
const current = (path: string, href: string) =>
  path === href || (href === '/' && path === '/notifications') || (href === '/more' && path.startsWith('/settings'))

export function TabBar() {
  const router = useRouter()
  const threads = useThreads()
  const unread = threads.data?.total ?? 0

  const items: TabItem[] = [
    { href: '/', label: 'Today', icon: 'home' },
    { href: '/devices', label: 'Devices', icon: 'devices' },
    { href: '/kids', label: 'Kids', icon: 'group' },
    { href: '/chat', label: 'Chat', icon: 'chat', badge: unread > 0 ? unread : undefined },
    { href: '/more', label: 'More', icon: 'more_vert' },
  ]

  return (
    <nav aria-label="Main" className="p-tabbar">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="p-tabbar-item"
          aria-current={current(router.pathname, item.href) ? 'page' : undefined}
        >
          <Icon name={item.icon} />
          <span className="p-tabbar-label">{item.label}</span>
          {/* after the label so the name reads "Chat 3 unread"; the badge is positioned in CSS */}
          {item.badge && (
            <span className="p-tabbar-badge">
              {item.badge > 9 ? '9+' : item.badge}
              <span className="p-sr"> unread</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  )
}
