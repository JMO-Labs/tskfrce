import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { ParentShell } from '../parent/ParentShell'
import { MoreMenu } from '../parent/MoreMenu'
import { FocusArea } from '../parent/SummaryRow'
import { useFocusAliases } from '../parent/focusAliases'
import { useFocusParam } from '../parent/useFocusParam'
import { EmptyState, ErrorPanel, OpeningLink, Skeleton } from '../parent/states'
import { useToday } from '../hooks/useToday'
import { useRunDetail } from '../hooks/useChores'
import { useKids } from '../hooks/useKids'
import { openingLabel } from './openingLabel'
import { HappyHourSheet } from './HappyHourButton'
import { HappyHourChip } from './HappyHourChip'
import { KidCard } from './KidCard'
import { KidFocus } from './KidFocus'
import { KidStrip } from './KidStrip'
import { isChore } from './needsActions'
import { NeedsStrip } from './NeedsStrip'
import { TipSlot } from './TipSlot'
import { AddonsRow, DevicesRow } from './TodayRows'

export function TodayPage() {
  const { data, isError, error, refetch } = useToday()
  const router = useRouter()
  const [hhOpen, setHhOpen] = useState(false)
  const kidFocus = useFocusParam('kid', { group: ['focus'], clears: ['chore'], valid: data ? (id) => data.kids.some((k) => String(k.id) === id) : undefined })
  const areaFocus = useFocusParam('focus', { group: ['kid'], clears: ['chore'], valid: (id) => ['needs', 'devices', 'addons'].includes(id) })
  // Closing Needs: useFocusParam hands focus back to the opener. If that is gone (last item cleared, strip removed), land on a calm anchor, never <body>.
  const needsWas = useRef(false)
  const needsNow = areaFocus.isOpen('needs')
  useEffect(() => {
    const was = needsWas.current
    needsWas.current = needsNow
    if (!was || needsNow) return
    const t = setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      const q = (sel: string) => document.querySelector<HTMLElement>(sel)
      ;(q('[data-focus-head="needs"]') ?? q('.pt-kcard [data-focus-head]') ?? q('.p-header h1, main h1'))?.focus({ preventScroll: true })
    }, 80)
    return () => clearTimeout(t)
  }, [needsNow])
  const focusedKid = data?.kids.find((k) => String(k.id) === kidFocus.open)
  const chore = useFocusParam('chore', { valid: focusedKid ? (id) => focusedKid.chores.some((c) => String(c.id) === id) : undefined })
  const kidOfRun = useCallback((runId: number) => data?.kids.find((k) => k.chores.some((c) => c.id === runId))?.id, [data])
  useFocusAliases(data ? kidOfRun : undefined)

  // link from a notification: say what is opening while the day loads
  const runId = Number(router.query.chore) || null
  const run = useRunDetail(runId)
  const kidList = useKids(!!runId)
  if (runId && !data && !isError)
    return (
      <main className="p-guard-state">
        <OpeningLink label={run.data ? openingLabel(run.data.title, run.data.kid_ids, kidList.data) : undefined} />
      </main>
    )

  const needs = data?.needs_you ?? []
  const calm = !kidFocus.open && !areaFocus.open
  const needsOpen = areaFocus.isOpen('needs')
  return (
    <ParentShell title="Today" actions={<MoreMenu label="More for Today" className="p-htool" items={[{ label: 'Start Happy Hour', icon: 'bolt', onClick: () => setHhOpen(true) }]} />}>
      <HappyHourSheet opened={hhOpen} onClose={() => setHhOpen(false)} allKids />
      {isError && !data && <ErrorPanel kind="unreachable" error={error} onRetry={() => refetch()} />}
      {!data && !isError && <Skeleton rows={4} />}
      {data && (
        <div className="p-today-detail">
          {calm && <HappyHourChip />}
          {(focusedKid || (needsOpen && data.kids.length > 0)) && (
            <KidStrip
              kids={data.kids}
              selected={focusedKid?.id}
              onSelect={(id) => kidFocus.openTo(String(id))}
              onAll={() => (focusedKid ? kidFocus.close() : areaFocus.close())}
              waiting={needs.length}
              onNeeds={needsOpen ? undefined : () => areaFocus.openTo('needs')}
            />
          )}
          {!kidFocus.open && <NeedsStrip items={needs} day={data.day} focus={areaFocus} />}
          {data.kids.length === 0 && (
            <EmptyState
              icon="person_add"
              title="Add your first kid"
              body="Then give them chores and devices. Takes about a minute."
              actions={[
                { label: 'Add a kid', icon: 'person_add', href: '/kids?section=kids', primary: true },
                { label: 'Run setup', icon: 'auto_fix_high', href: '/setup' },
              ]}
            />
          )}
          {!needsOpen && <div className="pt-kids">
            {(focusedKid ? [focusedKid] : data.kids).map((k) => (
              <KidCard key={k.id} kid={k} focus={kidFocus}>
                <KidFocus kid={k} requests={needs.filter((n) => n.kid_id === k.id || (isChore(n) && k.chores.some((c) => c.id === n.id)))} chore={chore} />
              </KidCard>
            ))}
          </div>}
          {calm && data.kids.length > 0 && <TipSlot kids={data.kids} />}
          {!kidFocus.open && !needsOpen && data.kids.length > 0 && (
            <FocusArea focus={areaFocus} label="More">
              <DevicesRow focus={areaFocus} />
              <AddonsRow focus={areaFocus} />
            </FocusArea>
          )}
        </div>
      )}
    </ParentShell>
  )
}
