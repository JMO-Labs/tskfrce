import Link from 'next/link'
import { useRouter } from 'next/router'
import { ReactNode } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import { Icon } from './Icon'
import { withoutFocus } from './useFocusParam'

/** Phone "‹ Label" bar above a detail (mockup .back). */
export function BackLink({ href, children }: { href: React.ComponentProps<typeof Link>['href']; children: ReactNode }) {
  return (
    <Link href={href} className="p-back-link">
      <Icon name="chevron_left" size={16} />
      {children}
    </Link>
  )
}

export function ListDetail({
  list,
  detail,
  listTitle,
  back,
  phone,
}: {
  list: ReactNode
  detail: ReactNode
  listTitle: ReactNode
  /** phone back-link label when it differs from the list title (the pane the detail belongs to) */
  back?: ReactNode
  /** phone only: replaces list-then-detail with this strip plus the detail */
  phone?: ReactNode
}) {
  const router = useRouter()
  const small = useMediaQuery('(max-width: 767px)')
  const { item: selectedItem, ...rest } = router.query

  if (small && phone) {
    return (
      <main className="p-detail-only">
        {phone}
        <div className="p-detail-panel">{detail}</div>
      </main>
    )
  }

  if (small && selectedItem) {
    return (
      <main className="p-detail-only">
        <BackLink href={{ pathname: router.pathname, query: withoutFocus(rest) }}>{back ?? listTitle}</BackLink>
        <div className="p-detail-panel">{detail}</div>
      </main>
    )
  }

  if (small) {
    return <main className="p-list-only">{list}</main>
  }

  return (
    <main className="p-list-detail">
      <div className="p-list-column">{list}</div>
      <div className="p-detail-column p-grid">{detail}</div>
    </main>
  )
}
