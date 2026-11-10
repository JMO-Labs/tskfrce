import { useHomeworkSites } from '@/v2/hooks/useHomework'
import { Icon } from '@/v2/parent/Icon'
import { SummaryRow } from '@/v2/parent/SummaryRow'
import { LoadFail } from '@/v2/parent/states'
import type { Focus } from '@/v2/parent/useFocusParam'
import type { Kid } from '@/v2/types'
import { SiteGroup } from './SiteGroup'

/** Per-kid extra homework sites; they add to the family list and never override a block. */
export function HomeworkRow({ kid, focus }: { kid: Kid; focus: Focus }) {
  const q = useHomeworkSites()
  const name = kid.full_name || kid.username
  const extra = q.data?.kids?.[String(kid.id)] ?? []
  const summary = q.isError ? "Couldn't load" : extra.length === 0 ? 'Family list only' : `${extra.length} extra ${extra.length === 1 ? 'site' : 'sites'}`
  return (
    <SummaryRow id="homework" icon={<Icon name="menu_book" size={18} />} title="Homework sites" summary={summary} loading={q.isPending} focus={focus}>
      {q.isError && <LoadFail error={q.error} onRetry={() => void q.refetch()} />}
      <p className="pk-hint">Adds to the family list. Blocked sites stay blocked.</p>
      <SiteGroup label={`Extra homework sites for ${name}`} domains={extra} kind="allow" kidId={kid.id} empty="None yet." />
    </SummaryRow>
  )
}
