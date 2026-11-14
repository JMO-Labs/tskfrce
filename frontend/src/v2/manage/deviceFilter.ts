import type { Device } from '@/v2/types'

export type SortKey = 'name' | 'last_seen' | 'first_seen' | 'ip' | 'maker'
export const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'last_seen', label: 'Last seen' },
  { value: 'first_seen', label: 'Newest' },
  { value: 'ip', label: 'IP address' },
  { value: 'maker', label: 'Maker' },
]

export type Flag = 'online' | 'locked' | 'unlocked' | 'alerts' | 'private' | 'unassigned'
export const FLAGS: { value: Flag; label: string }[] = [
  { value: 'online', label: 'Online now' },
  { value: 'locked', label: 'Locked' },
  { value: 'unlocked', label: 'Unlocked' },
  { value: 'alerts', label: 'Resisting / alerts' },
  { value: 'private', label: 'Private MAC' },
  { value: 'unassigned', label: 'Unassigned' },
]

export interface DeviceFilter { flags: Flag[]; owner: number | null; network: number | null; q: string }
export const EMPTY_FILTER: DeviceFilter = { flags: [], owner: null, network: null, q: '' }
export const isFiltered = (f: DeviceFilter) => f.flags.length > 0 || f.owner !== null || f.network !== null || f.q.trim() !== ''

const maker = (d: Device) => d.vendor || d.maker_guess || null
const time = (s?: string | null) => (s ? new Date(s).getTime() || null : null)
const ipNum = (ip?: string | null) => {
  if (!ip) return null
  const p = ip.split('.').map(Number)
  return p.length === 4 && p.every((n) => n >= 0 && n < 256) ? p.reduce((a, n) => a * 256 + n, 0) : null
}

/** Compare nullable keys: nulls always last. `dir` 1 = ascending, -1 = descending. */
const by = <T extends string | number>(key: (d: Device) => T | null, dir: 1 | -1) => (a: Device, b: Device) => {
  const x = key(a), y = key(b)
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return x < y ? -dir : x > y ? dir : 0
}
const byName = (a: Device, b: Device) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

const COMPARE: Record<SortKey, (a: Device, b: Device) => number> = {
  name: byName,
  last_seen: by((d) => time(d.last_seen), -1),
  first_seen: by((d) => time(d.first_seen), -1),
  ip: by((d) => ipNum(d.ip), 1),
  maker: by((d) => maker(d)?.toLowerCase() ?? null, 1),
}

/** New array; ties fall back to name so the order is stable. */
export const sortDevices = (list: Device[], key: SortKey): Device[] =>
  [...list].sort((a, b) => COMPARE[key](a, b) || byName(a, b))

const isLocked = (d: Device) => d.override?.action === 'lock' && !(d.override.expires_at && new Date(d.override.expires_at).getTime() <= Date.now())

const FLAG_TEST: Record<Flag, (d: Device) => boolean> = {
  online: (d) => d.seen_now,
  locked: isLocked,
  unlocked: (d) => !isLocked(d),
  alerts: (d) => d.resisting || d.alerts > 0,
  private: (d) => !!d.random_mac,
  unassigned: (d) => d.owner_ids.length === 0 && d.status !== 'guest',
}

export const matches = (d: Device, f: DeviceFilter): boolean => {
  if (!f.flags.every((fl) => FLAG_TEST[fl](d))) return false
  if (f.owner !== null && !d.owner_ids.includes(f.owner)) return false
  if (f.network !== null && d.network_id !== f.network) return false
  const q = f.q.trim().toLowerCase()
  if (!q) return true
  return [d.name, d.hostname, d.ip, d.mac, maker(d)].some((v) => v?.toLowerCase().includes(q))
}

export const applyDevices = (list: Device[], f: DeviceFilter, sort: SortKey): Device[] =>
  sortDevices(list.filter((d) => matches(d, f)), sort)

const storeKey = (scope: string) => `tf.sort.${scope}`
export const loadSort = (scope: string): SortKey => {
  try {
    const v = localStorage.getItem(storeKey(scope))
    return SORTS.some((s) => s.value === v) ? (v as SortKey) : 'name'
  } catch { return 'name' }
}
export const saveSort = (scope: string, key: SortKey) => {
  try { localStorage.setItem(storeKey(scope), key) } catch { /* private mode: ignore */ }
}
