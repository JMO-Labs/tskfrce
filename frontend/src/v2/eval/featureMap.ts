import { useEffect } from 'react'
import { track } from './track'

/** T1 `feature` areas; mirrors backend/app/eval/events.py AREAS. */
export const AREAS = [
  'goals', 'penalties', 'rewards', 'badges', 'minigames', 'homework', 'happy_hour', 'time_bank',
  'integrations', 'notifications', 'devices', 'wifi', 'updates', 'parents', 'reset',
] as const
export type Area = (typeof AREAS)[number]
export type Action = 'open' | 'start' | 'done' | 'fail' | 'toggle_on' | 'toggle_off' | 'create' | 'delete'
export interface Feature { area: Area; action: Action }

/** Where each area emits `open` (path under src/v2; checked by tests). */
export const OPEN_SITES: Record<Area, string> = {
  goals: 'manage/GoalsPane.tsx',
  penalties: 'manage/PenaltiesBody.tsx',
  rewards: 'manage/RewardsCatalogue.tsx',
  badges: 'manage/BadgesNav.tsx',
  minigames: 'games/GamesPage.tsx',
  homework: 'manage/HomeworkPane.tsx',
  happy_hour: 'manage/HappyHourPane.tsx',
  time_bank: 'manage/ScreenTimePane.tsx',
  integrations: 'integrations/IntegrationsPane.tsx',
  notifications: 'manage/NotificationsPane.tsx',
  devices: 'manage/DevicesPage.tsx',
  wifi: 'manage/WifiPane.tsx',
  updates: 'manage/UpdatesPane.tsx',
  parents: 'manage/ParentsPane.tsx',
  reset: 'login/ResetForm.tsx',
}

type Body = Record<string, unknown> | undefined
type Pick = Action | ((b: Body) => Action | null)
const flag = (key: string) => (b: Body): Action | null =>
  typeof b?.[key] === 'boolean' ? (b[key] ? 'toggle_on' : 'toggle_off') : null

const N = '\\d+'
// [method, path regex (ids as \d+), area, action]
const RULES: [string, string, Area, Pick][] = [
  ['POST', '/goals', 'goals', 'create'],
  ['POST', '/kid/goals/(start|suggest)', 'goals', 'start'],
  ['POST', `/kid/goals/${N}/done`, 'goals', 'done'],
  ['DELETE', `/kid/goals/${N}`, 'goals', 'delete'],
  ['POST', '/penalties(/goal)?', 'penalties', 'create'],
  ['POST', `/penalties/${N}/(forgive|cancel)`, 'penalties', 'delete'],
  ['POST', '/rewards', 'rewards', 'create'],
  ['DELETE', `/rewards/${N}`, 'rewards', 'delete'],
  ['POST', '/kid/redeem', 'rewards', 'start'],
  ['POST', `/redemptions/${N}/approve`, 'rewards', 'done'],
  ['POST', `/redemptions/${N}/deny`, 'rewards', 'fail'],
  ['POST', '/custom-badges', 'badges', 'create'],
  ['DELETE', `/custom-badges/${N}`, 'badges', 'delete'],
  ['POST', `/custom-badges/${N}/award`, 'badges', 'done'],
  ['POST', '/kid/games/start', 'minigames', 'start'],
  ['POST', '/kid/games/finish', 'minigames', 'done'],
  ['POST', '/kid/homework', 'homework', 'start'],
  ['POST', `/homework/requests/${N}/approve`, 'homework', 'done'],
  ['POST', `/homework/requests/${N}/deny`, 'homework', 'fail'],
  ['POST', '/happy-hour', 'happy_hour', 'start'],
  ['POST', `/happy-hour/${N}/stop`, 'happy_hour', 'done'],
  ['PATCH', '/screen-time', 'time_bank', flag('enabled')],
  ['PUT', `/screen-time/limits/${N}`, 'time_bank', 'create'],
  ['DELETE', `/screen-time/limits/${N}`, 'time_bank', 'delete'],
  ['POST', '/integrations', 'integrations', 'create'],
  ['DELETE', `/integrations/${N}`, 'integrations', 'delete'],
  ['PATCH', `/integrations/${N}`, 'integrations', flag('trusted')],
  ['POST', '/notify/places', 'notifications', 'create'],
  ['DELETE', `/notify/places/${N}`, 'notifications', 'delete'],
  ['POST', `/notify/places/${N}/test`, 'notifications', 'start'],
  ['DELETE', `/devices/${N}`, 'devices', 'delete'],
  ['POST', `/devices/${N}/test-block`, 'devices', 'start'],
  ['POST', '/network/wifi/forget', 'wifi', 'delete'],
  ['PATCH', '/updates', 'updates', 'done'],
  ['POST', '/users/invite', 'parents', 'create'],
  ['DELETE', '/users/invites/[^/]+', 'parents', 'delete'],
  ['POST', '/auth/reset', 'reset', 'done'],
  ['POST', `/parents/${N}/reset-link`, 'reset', 'create'],
]
const COMPILED = RULES.map(([m, p, area, pick]) => ({ m, re: new RegExp(`^${p}/?$`), area, pick }))

/** Map a mutating API call to its feature event; null when it is not a tracked action. */
export function featureFor(method: string, path: string, body?: unknown): Feature | null {
  const bare = path.split('?')[0]
  const b = body && typeof body === 'object' && !(body instanceof FormData) ? (body as Body) : undefined
  for (const r of COMPILED) {
    if (r.m !== method.toUpperCase() || !r.re.test(bare)) continue
    const action = typeof r.pick === 'function' ? r.pick(b) : r.pick
    return action ? { area: r.area, action } : null
  }
  return null
}

/** Called by api() after a mutation settles; ok=false turns the action into `fail`. Never throws. */
export function trackMutation(method: string, path: string, body: unknown, ok: boolean, kid: boolean): void {
  try {
    const f = featureFor(method, path, body)
    if (f) track('feature', { area: f.area, action: ok ? f.action : 'fail' }, { kid })
  } catch {
    /* telemetry must never break the app */
  }
}

/** Emit feature{area, action: open} once when the area's screen mounts. */
export function useFeatureOpen(area: Area, kid = false): void {
  useEffect(() => {
    track('feature', { area, action: 'open' }, { kid })
  }, [area, kid])
}
