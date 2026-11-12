import type { TodayKid } from '../types'
import { GetStartingChecklistCard, useChecklistShown } from './GetStartingChecklistCard'

/** The Getting started line. Nudges and tips live in Suggestions, so Today never shows two. */
export function TipSlot({ kids }: { kids: TodayKid[] }) {
  const checklist = useChecklistShown(kids)
  return checklist ? <GetStartingChecklistCard kids={kids} compact /> : null
}
