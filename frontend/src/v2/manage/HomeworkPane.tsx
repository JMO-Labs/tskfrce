import { useHomeworkSites } from '@/v2/hooks/useHomework'
import { ErrorPanel, Skeleton } from '@/v2/parent/states'
import { PaneCard, PaneHead } from './PaneParts'
import { SiteGroup } from './SiteGroup'
import { useFeatureOpen } from '@/v2/eval/featureMap'

/** Settings → Homework: the family's allowed and blocked sites for homework mode. */
export function HomeworkPane() {
  useFeatureOpen('homework')
  const q = useHomeworkSites()
  return (
    <>
      <PaneHead title="Homework" sub="Sites that work while homework mode is on" />
      {q.isError && <ErrorPanel kind="unreachable" error={q.error} onRetry={() => q.refetch()} />}
      {q.isPending && <Skeleton />}
      {q.data && (
        <>
          <PaneCard icon="library_books" title="Allowed for everyone">
            <SiteGroup label="Allowed for everyone" domains={q.data.allow} kind="allow" empty="Nothing added yet." />
          </PaneCard>
          <PaneCard icon="block" title="Never during homework">
            <SiteGroup label="Never during homework" domains={q.data.block} kind="block" empty="Nothing blocked yet." />
          </PaneCard>
          <PaneCard icon="verified" title={`Built-in sites (${q.data.starter.length})`}>
            <details>
              <summary>Show the list</summary>
              <p className="pk-hint">{q.data.starter.join(', ')}</p>
            </details>
          </PaneCard>
        </>
      )}
    </>
  )
}
