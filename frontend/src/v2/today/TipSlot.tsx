import { TipsContainer } from '../components/TipsContainer'
import { PARENT_TIPS } from '../tips'
import type { TodayKid } from '../types'
import { GetStartingChecklistCard, useChecklistShown } from './GetStartingChecklistCard'
import { TryCards, useTryCardKey } from './TryCards'

/** The one tip slot on calm Today: Getting started, else a Try card, else a plain tip. */
export function TipSlot({ kids }: { kids: TodayKid[] }) {
  const checklist = useChecklistShown(kids)
  const tryKey = useTryCardKey()
  if (checklist) return <GetStartingChecklistCard kids={kids} />
  if (tryKey) return <TryCards />
  return <TipsContainer tips={PARENT_TIPS} maxTips={1} />
}
