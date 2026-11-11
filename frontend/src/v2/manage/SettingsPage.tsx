import { useEffect } from 'react'
import { BackLink } from '@/v2/parent/ListDetail'
import { useMediaQuery } from '@mantine/hooks'
import { useRouter } from 'next/router'
import { ParentShell } from '@/v2/parent/ParentShell'
import { ErrorPanel, RowsSkeleton, Skeleton } from '@/v2/parent/states'
import { RequireParent } from '@/v2/components/RequireParent'
import { useFamily, usePatchFamily } from '@/v2/hooks/useFamily'
import { FamilyCard, GifsCard } from './FamilyCards'
import { IntegrationsPane } from '@/v2/integrations/IntegrationsPane'
import { HoursSection } from './HoursSection'
import { ParentsPane } from './ParentsPane'
import { PaneHead } from './PaneParts'
import { useSettingsLines } from './useSettingsLines'
import { SettingsList } from './SettingsList'
import { SETTINGS_SECTIONS, type S } from './settingsSections'
import { AppearancePane } from './AppearancePane'
import { HomeworkPane } from './HomeworkPane'
import { NotificationsPane } from './NotificationsPane'
import { accentHex } from '@/v2/parent/accent'
import { toastFail, toastOk } from '@/v2/notify'


const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function SettingsBody() {
  const { query, replace } = useRouter()
  const family = useFamily()
  const patch = usePatchFamily()
  const live: Partial<Record<S, string | undefined>> = useSettingsLines()
  const sections = SETTINGS_SECTIONS.map((s) => ({ ...s, description: live[s.id] ?? s.description }))
  const want = first(query.section)
  // Screen time moved to Kids & chores → Rewards (spec §11 erratum 1)
  useEffect(() => {
    if (want === 'screen') replace('/kids?section=rewards&item=screen')
  }, [want, replace])
  const small = useMediaQuery('(max-width: 767px)')
  const valid = SETTINGS_SECTIONS.some((s) => s.id === want)
  const section: S = valid ? (want as S) : 'family'
  const current = SETTINGS_SECTIONS.find((x) => x.id === section)!
  return (
    <ParentShell
      title="Settings"
      list={<SettingsList sections={sections} section={small && !valid ? undefined : section} bare={small} />}
      phone={valid ? <BackLink href="/settings">Settings</BackLink> : undefined}
    >
      <div className="ps-detail">
        {family.isError && ['family', 'look', 'gifs'].includes(section) && (
          <>
            <PaneHead title={current.label} sub={current.description} />
            <ErrorPanel kind="unreachable" error={family.error} onRetry={() => family.refetch()} />
          </>
        )}
        {family.isPending && section === 'family' && <div className="fam-rows"><RowsSkeleton rows={3} /></div>}
        {family.isPending && ['look', 'gifs'].includes(section) && <Skeleton />}
        {section === 'family' && family.data && <FamilyCard fam={family.data} />}
        {section === 'look' && family.data && (
          <AppearancePane
            current={family.data}
            onChange={(p) =>
              patch.mutate(p, {
                onError: (e) => {
                  document.documentElement.style.setProperty('--p-acc', accentHex(family.data?.accent))
                  toastFail(e)
                },
                onSuccess: () => toastOk('Saved'),
              })
            }
          />
        )}
        {section === 'gifs' && family.data && <GifsCard fam={family.data} />}
        {section === 'hours' && <HoursSection />}
        {section === 'notifications' && <NotificationsPane />}
        {section === 'homework' && <HomeworkPane />}
        {section === 'parents' && <ParentsPane />}
        {section === 'integrations' && <IntegrationsPane />}
      </div>
    </ParentShell>
  )
}

export function SettingsPage() {
  return (
    <RequireParent>
      <SettingsBody />
    </RequireParent>
  )
}
