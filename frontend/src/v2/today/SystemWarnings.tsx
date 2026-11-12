import Link from 'next/link'
import { Icon } from '../parent/Icon'
import { useSystemWarnings } from '../hooks/useSystemWarnings'

/** Strip above Today for serious box problems. No dismiss, no hide: it goes away when fixed. */
export function SystemWarnings() {
  const items = useSystemWarnings().data?.items ?? []
  if (items.length === 0) return null
  return (
    <section className="pt-warn" aria-label="System warnings" role="alert">
      <ul>
        {items.map((w) => (
          <li key={w.key} className="pt-warn-i">
            <Icon name="warning" size={18} />
            <div className="pt-warn-t">
              <b>{w.title}</b>
              <span>{w.body}</span>
            </div>
            <Link className="p-btn" data-variant="ink" href={w.action.to}>{w.action.label}</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
