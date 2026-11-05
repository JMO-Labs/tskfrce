import { Checkbox } from '@mantine/core'
import { Icon } from '@/v2/parent/Icon'
import type { PermissionOut } from './types'

const CONSEQUENCE: Record<string, string> = {
  'requests.decide': 'It can approve or deny on your behalf.',
  'widgets.kid': 'It can show its own cards to your kids.',
}

export const trustLine = (on: boolean) =>
  on ? 'Its chore check-offs will count right away, without your OK.' : 'Its chore check-offs wait in Needs you.'

/** Phone-style permission list: the fixed baseline, then one row per extra thing the app can do. */
export function PermissionList({ perms, picked, onToggle, scope = 'Its own settings, and nothing else unless listed above.' }: { scope?: string; perms: PermissionOut[]; picked?: string[]; onToggle?: (id: string) => void }) {
  const pick = !!onToggle // tickable rows: the parent chooses which permissions a key gets
  return (
    <>
    <ul className="ig-perms">
      {perms.map((p) => (
        <li key={p.id} className="ig-perm" data-risk={p.high_risk ? 'high' : undefined}>
          {pick ? (
            <Checkbox
              className="ig-ptext"
              label={p.text}
              description={p.high_risk ? (CONSEQUENCE[p.id] ?? 'Think twice before allowing this.') : undefined}
              checked={picked?.includes(p.id) ?? false}
              onChange={() => onToggle(p.id)}
            />
          ) : (
            <>
              <Icon name={p.high_risk ? 'warning' : 'check_circle'} size={20} />
              <span className="ig-ptext">
                {p.text}
                {p.high_risk && <small>{CONSEQUENCE[p.id] ?? 'Think twice before allowing this.'}</small>}
              </span>
            </>
          )}
          {p.high_risk && <span className="p-chip ig-risk">High risk</span>}
        </li>
      ))}
    </ul>
    {!pick && <p className="pn-help ig-scope">{scope}</p>}
    </>
  )
}
