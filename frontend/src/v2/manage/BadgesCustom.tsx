import { useCallback, useRef } from 'react'
import { useBadgeOverview, useCustomBadges } from '@/v2/hooks/useCustomBadges'
import { useKids } from '@/v2/hooks/useKids'
import { DetailHeader } from '@/v2/parent/DetailHeader'
import { Icon } from '@/v2/parent/Icon'
import { EmptyState, ErrorPanel, Skeleton } from '@/v2/parent/states'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import { useFocusParam, type Focus } from '@/v2/parent/useFocusParam'
import type { CustomBadge, Kid } from '@/v2/types'
import { BadgeDetail } from './BadgeDetail'
import { tierLabel } from './TierPips'
import { nameOf } from './choreMeta'

type Guard = (go: () => void) => void

/** "Mia · Copper, Leo · Silver" for the kids who have it, or "Not awarded yet". */
const whoHas = (tiers: Record<string, number>, kids: Kid[]) =>
  kids.filter((k) => (tiers[String(k.id)] ?? 0) > 0).map((k) => `${nameOf(k)} · ${tierLabel(tiers[String(k.id)])}`).join(', ') || 'Not awarded yet'

const tile = (glyph: string) => <span className="pk-tile bd-rtile"><Icon name={glyph} size={16} /></span>

/** Custom badges pane: one line per badge; the focused one (`?pick=`) opens its editor in place. */
export function BadgesCustom() {
  const badges = useCustomBadges()
  const overview = useBadgeOverview().data ?? []
  const kids = useKids().data ?? []
  const list = badges.data
  const pick = useFocusParam('pick', { valid: list ? (id) => id === 'new' || list.some((b) => String(b.id) === id) : undefined })
  const guard = useRef<Guard | null>(null)
  const setGuard = useCallback((g: Guard | null) => { guard.current = g }, [])
  // every way of leaving an edited badge asks first
  const ask = (go: () => void) => (guard.current ? guard.current(go) : go())
  const focus: Focus = { ...pick, openTo: (id, o) => ask(() => pick.openTo(id, o)), toggle: (id) => ask(() => pick.toggle(id)), close: () => ask(() => pick.close()) }
  const tiersOf = (id: number) => overview.find((o) => o.key === `custom:${id}`)?.tiers ?? {}
  const select = (id: number | null) => (id === null ? pick.close() : pick.openTo(String(id)))
  const row = (b?: CustomBadge) => (
    <SummaryRow
      key={b?.id ?? 'new'}
      id={String(b?.id ?? 'new')}
      icon={tile(b?.icon || 'military_tech')}
      title={b?.name ?? 'New badge'}
      summary={b ? whoHas(tiersOf(b.id), kids) : 'Not saved yet'}
      focus={focus}
    >
      <BadgeDetail key={b?.id ?? 'new'} badge={b} kids={kids} tiers={b ? tiersOf(b.id) : {}} onSelect={select} onGuard={setGuard} />
    </SummaryRow>
  )
  return (
    <div className="pk-detail bd-page">
      <DetailHeader
        media={<span className="pk-tile pk-tile-lg"><Icon name="military_tech" size={30} /></span>}
        title="Custom badges"
        sub="Each award moves a kid up a tier."
        main={<button type="button" className="p-btn" data-variant="accent" onClick={() => focus.openTo('new')}><Icon name="add" size={16} />New</button>}
      />
      {badges.isPending ? (
        <Skeleton />
      ) : badges.isError ? (
        <ErrorPanel kind="unreachable" error={badges.error} onRetry={() => badges.refetch()} />
      ) : list?.length || pick.isOpen('new') ? (
        <FocusArea focus={focus} label="Custom badges" grouped>
          {pick.isOpen('new') && row()}
          {list?.map((b) => row(b))}
        </FocusArea>
      ) : (
        <EmptyState icon="auto_awesome" title="No custom badges yet" body="Make one for the things you want to cheer on." />
      )}
    </div>
  )
}
