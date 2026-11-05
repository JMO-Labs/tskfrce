import { Icon } from '@/v2/parent/Icon'
import type { PermissionOut } from './types'

const CONSEQUENCE: Record<string, string> = {
  'requests.decide': 'It can approve or deny on your behalf.',
  'widgets.kid': 'It can show its own cards to your kids.',
}

/** Phone-style permission list: the fixed baseline, then one row per extra thing the app can do. */
export function PermissionList({ perms }: { perms: PermissionOut[] }) {
  return (
    <>
    <ul className="ig-perms">
      {perms.map((p) => (
        <li key={p.id} className="ig-perm" data-risk={p.high_risk ? 'high' : undefined}>
          <Icon name={p.high_risk ? 'warning' : 'check_circle'} size={20} />
          <span className="ig-ptext">
            {p.text}
            {p.high_risk && <small>{CONSEQUENCE[p.id] ?? 'Think twice before allowing this.'}</small>}
          </span>
          {p.high_risk && <span className="p-chip ig-risk">High risk</span>}
        </li>
      ))}
    </ul>
    <p className="pn-help ig-scope">Its own settings, and nothing else unless listed above.</p>
    </>
  )
}
