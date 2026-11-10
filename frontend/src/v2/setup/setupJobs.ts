import { api } from '@/v2/api'
import type { HourRule, HoursPayload, RuleBody } from '@/v2/hoursTypes'
import type { PresetBody, PresetCatalog, PresetKid, Style, KidPlan } from '@/v2/presets/types'
import type { Kid, LibChore } from '@/v2/types'
import { starter } from './starterChores'

export interface Job {
  key: string
  run: () => Promise<unknown>
}

const base: Pick<RuleBody, 'kind' | 'start_date' | 'end_date' | 'everyone' | 'kid_ids' | 'group_ids'> = { kind: 'allowed', start_date: null, end_date: null, everyone: true, kid_ids: [], group_ids: [] }

export const DEFAULT_DRAFTS: RuleBody[] = [
  { ...base, name: 'School nights', category: 'school_night', days: '01236', times: [{ start: '07:00', end: '20:00' }] },
  { ...base, name: 'Weekends', category: 'weekend', days: '45', times: [{ start: '08:00', end: '22:00' }] },
]

/** The wizard's kids as the presets API sees them. `styles` null = everyone follows the family; else a missing kid gets `family`. */
export const presetKids = (kids: Kid[], styles: Record<number, Style> | null, family?: Style): PresetKid[] =>
  kids.map((k) => ({ id: k.id, name: k.full_name || k.username, age_group: k.age_group, style: styles ? (styles[k.id] ?? family ?? null) : null }))

/** POST /presets/apply body: kids map only carries styles when "Different for each kid" is on. */
export function applyBody(style: Style, kids: Kid[], styles: Record<number, Style> | null, skip?: string[]): PresetBody {
  const map = Object.fromEntries(kids.map((k) => [k.id, styles ? (styles[k.id] ?? style) : null]))
  return { style, kids: map, ...(skip ? { skip } : {}) }
}

/** One school-night and one weekend rule per distinct bedtime; a single Everyone rule when all kids agree. */
export function hoursFromPlans(kids: { id: number; name: string; plan: KidPlan }[]): RuleBody[] {
  if (kids.length === 0) return []
  const out: RuleBody[] = []
  for (const [i, d] of DEFAULT_DRAFTS.entries()) {
    const at = (k: { plan: KidPlan }) => (i === 0 ? k.plan.bedtime : k.plan.weekend)
    const ends = Array.from(new Set(kids.map(at)))
    const start = d.times[0].start
    if (ends.length === 1) out.push({ ...d, times: [{ start, end: ends[0] }] })
    else
      for (const end of ends) {
        const who = kids.filter((k) => at(k) === end)
        out.push({ ...d, name: `${d.name} · ${who.map((k) => k.name).join(', ')}`, everyone: false, kid_ids: who.map((k) => k.id), times: [{ start, end }] })
      }
  }
  return out
}

export const planFor = (c: PresetCatalog, k: PresetKid, family: Style): KidPlan => c.plans[k.age_group][k.style ?? family]

/** What the Tweak path starts from: the kids' plans, merged. */
export function tweakStart(kids: PresetKid[], catalog: PresetCatalog, family: Style) {
  const plans = kids.map((k) => ({ id: k.id, name: k.name, plan: planFor(catalog, k, family) }))
  const assign: Record<string, number[]> = {}
  for (const p of plans) for (const t of p.plan.chores) (assign[t] ??= []).push(p.id)
  return {
    chores: Object.keys(assign),
    assign,
    hours: hoursFromPlans(plans),
    lock: plans.some((p) => p.plan.lock),
    trust: plans.filter((p) => p.plan.trust).map((p) => p.id),
  }
}

/** Created chores and the built-in types, kept across retries so a retry only redoes what failed. */
export const newChoreCache = () => ({ ids: new Map<string, number>(), types: null as Promise<{ id: number; name: string }[]> | null })
export type ChoreCache = ReturnType<typeof newChoreCache>

const choreTypes = (c: ChoreCache) =>
  (c.types ??= api<unknown>('/chore-types')
    .then((r) => (Array.isArray(r) ? (r as { id: number; name: string }[]) : []))
    .catch(() => []))

/** Create each picked chore (once) and assign it. `kidsFor` says who gets it. */
export const choreJobs = (titles: string[], kidsFor: (title: string) => number[], cache: ChoreCache): Job[] =>
  titles.map((title) => ({
    key: `chore:${title}`,
    run: async () => {
      let id = cache.ids.get(title)
      if (id === undefined) {
        // made before a reload? then it is already assigned: don't make it twice
        const have = await api<LibChore[]>('/chores/')
        if (Array.isArray(have) && have.some((c) => c.title === title)) return
        const st = starter(title)
        const types = await choreTypes(cache)
        const typeId = types.find((t) => t.name === st?.type)?.id
        const c = await api<{ id: number }>('/chores/', {
          method: 'POST',
          body: { title, points: st?.points ?? 10, needs_photo: false, steps: [], ...(typeId ? { type_id: typeId } : {}) },
        })
        id = c.id
        cache.ids.set(title, id)
      }
      const days = starter(title)?.days
      await api(`/chores/${id}/assignments`, {
        method: 'POST',
        body: { kid_ids: kidsFor(title), mode: 'each', repeat: days ? { type: 'weekly', days } : { type: 'daily', days: [] }, on_date: null, due_time: null },
      })
    },
  }))

export const hoursJobs = (hours: RuleBody[], choresLock: boolean): Job[] => [
  ...hours.map((body, i) => ({
    key: `rule:${i}`,
    run: async () => {
      const have = await api<HoursPayload>('/hours') // an earlier try must not duplicate an identical rule
      const same = (r: HourRule) => r.name === body.name && r.category === body.category && r.kind === body.kind && r.days === body.days && r.everyone === body.everyone && r.start_date === body.start_date && r.end_date === body.end_date && JSON.stringify(r.times.map((t) => [t.start, t.end])) === JSON.stringify(body.times.map((t) => [t.start, t.end]))
      if (!have?.rules?.some(same)) await api('/hours', { method: 'POST', body })
    },
  })),
  { key: `chores_lock:${choresLock}`, run: () => api('/family', { method: 'PATCH', body: { chores_lock: choresLock } }) },
]

export const extrasJobs = (trustKids: number[], bedtimeAuto: boolean, goalsOn = true): Job[] => [
  ...trustKids.map((id) => ({ key: `trust:${id}`, run: () => api(`/kids/${id}`, { method: 'PATCH', body: { trust_mode: true } }) })),
  ...(bedtimeAuto ? [{ key: 'bedtime', run: () => api('/family', { method: 'PATCH', body: { bedtime_auto: true } }) }] : []),
  { key: `goals:${goalsOn}`, run: () => api('/goals/settings', { method: 'PATCH', body: { on: goalsOn } }) },
]
