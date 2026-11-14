import type { CSSProperties } from 'react'
import { useKids } from '@/v2/hooks/useKids'

/**
 * Kid identity colors = the validated categorical chart palette (dark steps, >=3:1 on both
 * surfaces with dark ink), in fixed order by kid id, so bubbles and Today charts match.
 * ponytail: one step for both themes; split light/dark steps if light-mode charts need them.
 */
export const KID_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']

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
    const last = w.length > 1 ? w[w.length - 1] : ''
    if (last) c.push((first[0] + (/^\d+$/.test(last) ? last.slice(0, 2) : Array.from(last)[0])).toUpperCase())
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
/** `alt` names the bubble as an image for assistive tech; without it the bubble is decorative. */
export function KidAv({ id, name, className = 'pk-av', title, alt }: { id: number | null | undefined; name: string | null; className?: string; title?: string; alt?: string }) {
  const { label, style } = useKidBadge(id, name)
  const a11y = alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true as const }
  return (
    <span className={className} style={style} title={title} {...a11y}>
      {label}
    </span>
  )
}
