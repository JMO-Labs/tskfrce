import { ParentShell } from '@/v2/parent/ParentShell'
import { RequireParent } from './RequireParent'
import { BackLink } from '@/v2/parent/ListDetail'
import { List } from './Bell'

/** See all: the bell's list, full width (§3.7). */
export function NotificationsPage() {
  return (
    <RequireParent>
      <ParentShell title="Notifications" above={<BackLink href="/">Today</BackLink>}>
        <List onGo={() => {}} page />
      </ParentShell>
    </RequireParent>
  )
}
