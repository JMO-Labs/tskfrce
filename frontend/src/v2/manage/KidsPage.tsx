import { useCallback, useEffect, useRef } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { ParentShell } from '@/v2/parent/ParentShell'
import { useFocusAliases } from '@/v2/parent/focusAliases'
import { useMediaQuery } from '@mantine/hooks'
import { EmptyState, ErrorPanel, Skeleton } from '@/v2/parent/states'
import { RequireParent } from '@/v2/components/RequireParent'
import { useLibrary } from '@/v2/hooks/useChores'
import { useKids } from '@/v2/hooks/useKids'
import { BadgesAll } from './BadgesAll'
import { BadgesCustom } from './BadgesCustom'
import { BadgesNav } from './BadgesNav'
import { BadgesRecent } from './BadgesRecent'
import { ChoreDetail } from './ChoreDetail'
import { ChoresList } from './ChoresList'
import { KidDetail, type LeaveGuard } from './KidDetail'
import { KidEditor } from './KidEditor'
import { KidsList } from './KidsList'
import { KidsTabs, SECTIONS, type Section } from './KidsTabs'
import { RewardsCatalogue } from './RewardsCatalogue'
import { RewardsHistory } from './RewardsHistory'
import { RewardsNav } from './RewardsNav'
import { RewardsRequests } from './RewardsRequests'
import { HappyHourPane } from './HappyHourPane'
import { GoalsPane } from './GoalsPane'
import { GoalSettingsPane } from './GoalSettingsPane'
import { ScreenTimePane } from './ScreenTimePane'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
/** phone back-link label per pane (the mockups name the pane, not the page) */
const BACK: Record<Section, string> = { chores: 'Chores', kids: 'Kids & chores', rewards: 'Rewards', badges: 'Badges' }
const FIXED: Partial<Record<Section, string>> = { rewards: 'requests', badges: 'all' }

function KidsBody() {
  const router = useRouter()
  const { query } = router
  const kids = useKids()
  const chores = useLibrary()
  const want = first(query.section)
  const section: Section = SECTIONS.some((s) => s.id === want) ? (want as Section) : 'chores'
  const kidList = kids.data ?? []
  const small = useMediaQuery('(max-width: 767px)')
  // rewards and badges are fixed sets of panes (Requests, Catalogue, ...), not lists of records
  const fixed = FIXED[section]
  // desktop opens the section's first item rather than an empty pane; phone stays on the list
  const firstId = { chores: chores.data, kids: kids.data, rewards: undefined, badges: undefined }[section]?.[0]?.id
  const item = first(query.item) ?? (small || query.kid ? undefined : (fixed ?? (firstId == null ? undefined : String(firstId))))
  const leave = useRef<LeaveGuard | null>(null)
  const setGuard = useCallback((g: LeaveGuard | null) => { leave.current = g }, [])
  const pick = (id: number | string | null, now = false) => {
    const { item: _drop, pick: _pick, open: _o, edit: _e, pin: _p, ...rest } = query
    const go = () => router.push({ pathname: '/kids', query: id === null ? { section } : { ...rest, section, item: id } }, undefined, { shallow: true })
    if (leave.current && !now) leave.current(go) // the kid page asks about unsaved edits first
    else go()
  }
  // a fixed pane's own selection (?pick=) inside `pane`
  const pickIn = (pane: string) => (id: number | 'new' | null) =>
    router.push({ pathname: '/kids', query: { section, item: pane, ...(id !== null && { pick: id }) } }, undefined, { shallow: true })

  // A deleted (or stale) ?item= falls back to the section's list (fixed panes never are)
  const loaded = section === 'chores' ? chores : kids
  const known = loaded.data?.some((x) => String(x.id) === item)
  useEffect(() => {
    if (!fixed && loaded.isSuccess && item && item !== 'new' && !known) pick(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.isSuccess, item, known])

  // old links (/kids?kid=7&pin=1, #trust) become item/open/edit URLs
  useFocusAliases()

  const lists = {
    chores: <ChoresList chores={chores.data ?? []} kids={kidList} selected={item} onSelect={pick} />,
    kids: <KidsList kids={kidList} selected={item} onSelect={pick} />,
    rewards: <RewardsNav selected={item} onSelect={pick} />,
    badges: <BadgesNav selected={item} onSelect={pick} />,
  }

  const id = Number(item)
  const chore = chores.data?.find((c) => c.id === id)
  const kid = kidList.find((k) => k.id === id)
  const select = (n: number | null) => pick(n)
  const details = {
    chores: item === 'new' ? <ChoreDetail key="new" kids={kidList} onSelect={select} onGuard={setGuard} /> : chore && <ChoreDetail key={chore.id} kids={kidList} chore={chore} onSelect={select} onGuard={setGuard} />,
    kids:
      item === 'new' ? (
        <div className="pk-detail"><div className="pk-grid"><KidEditor onCreated={pick} /></div></div>
      ) : (
        kid && <KidDetail key={kid.id} kid={kid} guardRef={leave} onDeleted={() => pick(null, true)} />
      ),
    rewards:
      item === 'requests' ? (
        <RewardsRequests onHistory={() => pick('history')} />
      ) : item === 'catalogue' ? (
        <RewardsCatalogue pick={first(query.pick)} onPick={pickIn('catalogue')} />
      ) : item === 'screen' ? (
        <ScreenTimePane />
      ) : item === 'happy' ? (
        <HappyHourPane />
      ) : item === 'goals' ? (
        <GoalsPane onSettings={() => pick('goal-settings')} />
      ) : item === 'goal-settings' ? (
        <GoalSettingsPane onBack={() => pick('goals')} />
      ) : item === 'history' ? (
        <RewardsHistory />
      ) : null,
    badges:
      item === 'all' ? (
        <BadgesAll />
      ) : item === 'custom' ? (
        <BadgesCustom />
      ) : item === 'recent' ? (
        <BadgesRecent />
      ) : null,
  }

  const noun = { chores: 'chore', kids: 'kid', rewards: 'reward', badges: 'badge' }[section]
  const total = loaded.data?.length
  const EMPTY_ICON = { chores: 'task_alt', kids: 'person_add', rewards: 'redeem', badges: 'military_tech' }
  return (
    <>
    <Head>
      <title>{`${SECTIONS.find((s) => s.id === section)?.label} - Kids & chores - t@sk4ce`}</title>
    </Head>
    <ParentShell
      title="Kids & chores"
      back={BACK[section]}
      list={
        <>
          <KidsTabs
            section={section}
            counts={{ chores: chores.data?.length, kids: kids.data?.length }}
          />
          {loaded.isPending ? <Skeleton /> : lists[section]}
        </>
      }
    >
      {loaded.isError && <ErrorPanel kind="unreachable" error={loaded.error} onRetry={() => loaded.refetch()} />}
      {details[section] ||
        (!fixed && !loaded.isError && total === 0 && (
          <EmptyState
            icon={EMPTY_ICON[section]}
            title={`No ${noun}s yet`}
            body={`Add your first ${noun} to get started.`}
            actions={[{ label: `Add a ${noun}`, icon: 'add', primary: true, onClick: () => pick('new') }]}
          />
        ))}
    </ParentShell>
    </>
  )
}

export function KidsPage() {
  return (
    <RequireParent>
      <KidsBody />
    </RequireParent>
  )
}
