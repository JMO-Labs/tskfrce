import { applyDevices, loadSort, saveSort, sortDevices, EMPTY_FILTER, type DeviceFilter } from '@/v2/manage/deviceFilter'
import type { Device } from '@/v2/types'

const dev = (o: Partial<Device>): Device => ({
  id: 1, name: 'Dev', mac: 'aa:bb:cc:00:00:01', vendor: null, status: 'assigned', owner_ids: [], group_ids: [],
  online: true, override: null, last_seen: null, seen_now: false, resisting: false, exempt: false, reason: null,
  chores_done: 0, chores_total: 0, locks_at: null, alerts: 0, ...o,
} as Device)
const ids = (l: Device[]) => l.map((d) => d.id)
const f = (o: Partial<DeviceFilter>): DeviceFilter => ({ ...EMPTY_FILTER, ...o })

describe('sortDevices', () => {
  it('name, case-insensitive', () => {
    const l = [dev({ id: 1, name: 'beta' }), dev({ id: 2, name: 'Alpha' })]
    expect(ids(sortDevices(l, 'name'))).toEqual([2, 1])
  })
  it('last seen newest first, null last', () => {
    const l = [dev({ id: 1 }), dev({ id: 2, last_seen: '2026-01-01T00:00:00Z' }), dev({ id: 3, last_seen: '2026-02-01T00:00:00Z' })]
    expect(ids(sortDevices(l, 'last_seen'))).toEqual([3, 2, 1])
  })
  it('first seen newest first, null last', () => {
    const l = [dev({ id: 1, first_seen: null }), dev({ id: 2, first_seen: '2026-01-01T00:00:00Z' }), dev({ id: 3, first_seen: '2026-03-01T00:00:00Z' })]
    expect(ids(sortDevices(l, 'first_seen'))).toEqual([3, 2, 1])
  })
  it('ip numerically, null last', () => {
    const l = [dev({ id: 1, ip: null }), dev({ id: 2, ip: '192.168.1.100' }), dev({ id: 3, ip: '192.168.1.20' })]
    expect(ids(sortDevices(l, 'ip'))).toEqual([3, 2, 1])
  })
  it('maker, missing last; does not mutate', () => {
    const l = [dev({ id: 1 }), dev({ id: 2, vendor: 'Sony' }), dev({ id: 3, maker_guess: 'Apple' })]
    expect(ids(sortDevices(l, 'maker'))).toEqual([3, 2, 1])
    expect(ids(l)).toEqual([1, 2, 3])
  })
})

describe('applyDevices filters', () => {
  const l = [
    dev({ id: 1, name: 'Xbox', online: true, seen_now: true, owner_ids: [7], ip: '10.0.0.5', network_id: 1 }),
    dev({ id: 2, name: 'Phone', override: { action: 'lock', expires_at: null } as Device['override'], alerts: 2, random_mac: true, owner_ids: [8], network_id: 2 }),
    dev({ id: 3, name: 'TV', status: 'unassigned', resisting: true, vendor: 'Sony', hostname: 'bravia' }),
  ]
  it('empty filter keeps all', () => expect(ids(applyDevices(l, EMPTY_FILTER, 'name'))).toEqual([2, 3, 1]))
  it('online now', () => expect(ids(applyDevices(l, f({ flags: ['online'] }), 'name'))).toEqual([1]))
  it('locked / unlocked', () => {
    expect(ids(applyDevices(l, f({ flags: ['locked'] }), 'name'))).toEqual([2])
    expect(ids(applyDevices(l, f({ flags: ['unlocked'] }), 'name'))).toEqual([3, 1])
  })
  it('resisting/alerts, private mac, unassigned', () => {
    expect(ids(applyDevices(l, f({ flags: ['alerts'] }), 'name'))).toEqual([2, 3])
    expect(ids(applyDevices(l, f({ flags: ['private'] }), 'name'))).toEqual([2])
    expect(ids(applyDevices(l, f({ flags: ['unassigned'] }), 'name'))).toEqual([3])
  })
  it('owner and network', () => {
    expect(ids(applyDevices(l, f({ owner: 8 }), 'name'))).toEqual([2])
    expect(ids(applyDevices(l, f({ network: 1 }), 'name'))).toEqual([1])
  })
  it('filters AND together', () => {
    expect(ids(applyDevices(l, f({ flags: ['online', 'alerts'] }), 'name'))).toEqual([])
    expect(ids(applyDevices(l, f({ flags: ['alerts'], owner: 8 }), 'name'))).toEqual([2])
  })
  it('search name/hostname/ip/mac/maker', () => {
    expect(ids(applyDevices(l, f({ q: 'xbo' }), 'name'))).toEqual([1])
    expect(ids(applyDevices(l, f({ q: 'bravia' }), 'name'))).toEqual([3])
    expect(ids(applyDevices(l, f({ q: '10.0.0.5' }), 'name'))).toEqual([1])
    expect(ids(applyDevices(l, f({ q: 'AA:BB' }), 'name'))).toEqual([2, 3, 1])
    expect(ids(applyDevices(l, f({ q: 'sony' }), 'name'))).toEqual([3])
  })
})

describe('sort persistence', () => {
  beforeEach(() => localStorage.clear())
  it('round-trips and defaults', () => {
    expect(loadSort('devices')).toBe('name')
    saveSort('devices', 'ip')
    expect(loadSort('devices')).toBe('ip')
  })
  it('ignores junk and survives storage errors', () => {
    localStorage.setItem('tf.sort.devices', 'bogus')
    expect(loadSort('devices')).toBe('name')
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('quota') }
    expect(() => saveSort('devices', 'ip')).not.toThrow()
    Storage.prototype.setItem = orig
  })
})
