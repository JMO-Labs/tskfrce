import { useHomeworkSites } from '@/v2/hooks/useHomework'
import { Icon } from '@/v2/parent/Icon'
import { SiteGroup } from './SiteGroup'

/** Per-kid extra homework sites; they add to the family list and never override a block. */
export function KidHomeworkSites({ kidId, name }: { kidId: number; name: string }) {
  const sites = useHomeworkSites().data
  const title = `Extra homework sites for ${name}`
  return (
    <section className="pk-panel pk-span" aria-label={title}>
      <h3>
        <Icon name="menu_book" size={18} />
        {title}
      </h3>
      <p className="pk-hint">Adds to the family list. Blocked sites stay blocked.</p>
      <SiteGroup label={title} domains={sites?.kids?.[String(kidId)] ?? []} kind="allow" kidId={kidId} empty="None yet." />
    </section>
  )
}
