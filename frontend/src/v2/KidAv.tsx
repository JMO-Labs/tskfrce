import type { CSSProperties } from 'react'
import { useKids } from '@/v2/hooks/useKids'

/** Light fills that keep dark text readable in both themes; kids get them in id order. */
export const KID_COLORS = ['#ffd84a', '#8fd3ff', '#ff9fb2', '#a8e6a1', '#c9b6ff', '#ffb870', '#7fe0d4', '#e6c79c']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/**
 * Family-unique short labels ("Ri"/"Ev"). Kids sharing a first name fall back to first + last
 * initial ("R6"/"R9"), then a 3-letter prefix, then letter + index, while others keep two letters.
 */
export function kidBadges(kids: { id: number; name: string | null }[]): Map<number, { label: string; color: string }> {
  const sorted = [...kids].sort((a, b) => a.id - b.id)
  const cands = sorted.map((k, i) => {
    const w = (k.name ?? '').trim().split(/\s+/).filter(Boolean)
    const first = Array.from(w[0] ?? '?')
    const c = [cap(first.slice(0, 2).join(''))]
    if (w.length > 1) c.push((first[0] + Array.from(w[w.length - 1])[0]).toUpperCase())
    if (first.length > 2) c.push(cap(first.slice(0, 3).join('')))
    c.push(`${first[0].toUpperCase()}${i + 1}`)
    return { first: (w[0] ?? '').toLowerCase(), c }
  })
  const at = sorted.map(() => 0)
  for (let round = 0; round < 4; round++) {
    const label = (i: number) => cands[i].c[Math.min(at[i], cands[i].c.length - 1)]
    const dup = sorted.map((_, i) => sorted.some((__, j) => j !== i && label(j) === label(i)))
    if (!dup.includes(true)) break
    const shared = (i: number) => sorted.some((__, j) => j !== i && dup[j] && label(j) === label(i) && cands[j].first === cands[i].first)
    const anyShared = dup.some((d, i) => d && shared(i))
    const bump = dup.map((d, i) => d && (!anyShared || shared(i)))
    bump.forEach((b, i) => { if (b) at[i]++ })
  }
  const out = new Map<number, { label: string; color: string }>()
  sorted.forEach((k, i) => out.set(k.id, { label: cands[i].c[Math.min(at[i], cands[i].c.length - 1)], color: KID_COLORS[i % KID_COLORS.length] }))
  return out
}

type Badge = { label: string; style?: CSSProperties }

/** Badge lookup over a known kid list: label + fill style; first letter, unstyled, if absent. */
export function badgesFor(kids: { id: number; name: string | null }[]): (id: number | null | undefined, name: string | null) => Badge {
  const map = kidBadges(kids)
  return (id, name) => {
    const b = id != null ? map.get(id) : undefined
    if (!b) return { label: (Array.from(name?.trim() ?? '')[0] ?? '?').toUpperCase() }
    return { label: b.label, style: { background: b.color, color: '#1c1c1b', borderColor: b.color } }
  }
}

/** Same, over the family's kids from the shared ['kids'] query. */
export function useKidBadges() {
  const data = useKids().data
  const kids = Array.isArray(data) ? data : []
  return badgesFor(kids.map((k) => ({ id: k.id, name: k.full_name ?? k.username ?? null })))
}

export const useKidBadge = (id: number | null | undefined, name: string | null): Badge => useKidBadges()(id, name)

/** Kid bubble span: unique short label in the kid's color. */
export function KidAv({ id, name, className = 'pk-av', title }: { id: number | null | undefined; name: string | null; className?: string; title?: string }) {
  const { label, style } = useKidBadge(id, name)
  return (
    <span className={className} style={style} title={title} aria-hidden="true">
      {label}
    </span>
  )
}
