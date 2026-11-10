import type { NeedsItem } from '../types'

export interface NeedsGroup { key: string; kidId: number | null; name: string; items: NeedsItem[] }

/** Oldest first; an item without a submitted time sorts after the timed ones and never sets its group's age. */
const byAge = (a: NeedsItem, b: NeedsItem) => {
  if (!a.submitted_at || !b.submitted_at) return a.submitted_at ? -1 : b.submitted_at ? 1 : 0
  return a.submitted_at < b.submitted_at ? -1 : a.submitted_at > b.submitted_at ? 1 : 0
}

/** One group per kid, oldest group first; items with no kid form the last group, "A kid". */
export function groupNeeds(items: NeedsItem[]): NeedsGroup[] {
  const map = new Map<string, NeedsGroup>()
  for (const i of [...items].sort(byAge)) {
    const key = i.kid_id == null ? 'none' : String(i.kid_id)
    const g = map.get(key) ?? { key, kidId: i.kid_id ?? null, name: i.kid_name ?? 'A kid', items: [] }
    g.items.push(i)
    map.set(key, g)
  }
  const groups = [...map.values()]
  const age = (g: NeedsGroup) => g.items[0].submitted_at ?? ''
  const rank = (g: NeedsGroup) => (g.kidId == null ? 2 : g.items[0].submitted_at ? 0 : 1)
  return groups.sort((a, b) => rank(a) - rank(b) || (age(a) < age(b) ? -1 : age(a) > age(b) ? 1 : 0))
}
