import { Icon } from '@/v2/parent/Icon'
import type { PermissionOut } from './types'

const CONSEQUENCE: Record<string, string> = {
  'requests.decide': 'It can approve or deny on your behalf.',
}

/** Phone-style permission list: the fixed baseline, then one row per extra thing the app can do. */
export function PermissionList({ perms }: { perms: PermissionOut[] }) {
  return (
    <ul className="ig-perms">
      <li className="ig-perm">
        <Icon name="check_circle" size={20} />
        <span className="ig-ptext">Its own settings, and nothing else unless listed below.</span>
      </li>
      {perms.map((p) => (
        <li key={p.id} className="ig-perm" data-risk={p.high_risk ? 'high' : undefined}>
          <Icon name={p.high_risk ? 'warning' : 'check_circle'} size={20} />
          <span className="ig-ptext">
            {p.text}
            {p.high_risk && CONSEQUENCE[p.id] && <small>{CONSEQUENCE[p.id]}</small>}
          </span>
          {p.high_risk && <span className="p-chip ig-risk">High risk</span>}
        </li>
      ))}
    </ul>
  )
}
