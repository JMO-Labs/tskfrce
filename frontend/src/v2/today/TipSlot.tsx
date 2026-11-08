import { useDismissTip, useTips } from '../hooks/useTips'
import { PARENT_TIPS } from '../tips'
import type { TodayKid } from '../types'
import { GetStartingChecklistCard, useChecklistShown } from './GetStartingChecklistCard'
import { TipLine } from './TipLine'
import { TryCards, useTryCardKey } from './TryCards'

/** The one tip slot on calm Today, always the one-line tip: Getting started, else a Try card, else a plain tip. */
export function TipSlot({ kids }: { kids: TodayKid[] }) {
  const checklist = useChecklistShown(kids)
  const tryKey = useTryCardKey()
  const dismissed = useTips().data?.dismissed
  const dismiss = useDismissTip()
  if (checklist) return <GetStartingChecklistCard kids={kids} compact />
  if (tryKey) return <TryCards compact />
  const tip = dismissed && PARENT_TIPS.find((t) => !dismissed.includes(t.key))
  return tip ? <TipLine icon={tip.icon} text={tip.text} onDismiss={() => dismiss.mutate(tip.key)} /> : null
}
