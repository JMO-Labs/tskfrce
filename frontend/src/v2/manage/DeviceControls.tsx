import { useState } from 'react'
import { Icon } from '@/v2/parent/Icon'
import { EMPTY_FILTER, FLAGS, SORTS, isFiltered, loadSort, saveSort, type DeviceFilter, type Flag, type SortKey } from './deviceFilter'

/** Sort + filter state for one list; the sort choice persists per browser under `scope`. */
export function useDeviceView(scope: string) {
  const [sort, setSortState] = useState<SortKey>(() => loadSort(scope))
  const [filter, setFilter] = useState<DeviceFilter>(EMPTY_FILTER)
  const setSort = (k: SortKey) => { setSortState(k); saveSort(scope, k) }
  return { sort, setSort, filter, setFilter, clear: () => setFilter(EMPTY_FILTER) }
}

interface Props {
  sort: SortKey
  onSort: (k: SortKey) => void
  filter: DeviceFilter
  onFilter: (f: DeviceFilter) => void
  owners?: { id: number; name: string }[]
  networks?: { id: number; label: string }[]
}

/** One compact row: search, sort dropdown, and a Filter button that opens the chips. */
export function DeviceControls({ sort, onSort, filter, onFilter, owners = [], networks = [] }: Props) {
  const [open, setOpen] = useState(false)
  const n = filter.flags.length + (filter.owner !== null ? 1 : 0) + (filter.network !== null ? 1 : 0)
  const toggle = (f: Flag) => onFilter({ ...filter, flags: filter.flags.includes(f) ? filter.flags.filter((x) => x !== f) : [...filter.flags, f] })
  const chip = (on: boolean, label: string, click: () => void) => (
    <button key={label} type="button" className="p-chip p-fchip" data-on={on} aria-pressed={on} onClick={click}>{label}</button>
  )
  return (
    <div className="p-dctl">
      <div className="p-dctl-row">
        <input type="search" className="p-dctl-q" aria-label="Search devices" placeholder="Search name, IP, MAC, maker" value={filter.q} onChange={(e) => onFilter({ ...filter, q: e.target.value })} />
        <select className="p-net-filter" aria-label="Sort devices" value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" className="p-net-filter p-dctl-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="filter_list" size={16} />Filter{n > 0 && ` · ${n}`}
        </button>
      </div>
      {open && (
        <div className="p-dctl-panel" role="group" aria-label="Filters">
          <div className="p-dctl-chips">{FLAGS.map((f) => chip(filter.flags.includes(f.value), f.label, () => toggle(f.value)))}</div>
          {owners.length > 0 && (
            <div className="p-dctl-chips" aria-label="Owner">{owners.map((o) => chip(filter.owner === o.id, o.name, () => onFilter({ ...filter, owner: filter.owner === o.id ? null : o.id })))}</div>
          )}
          {networks.length > 1 && (
            <div className="p-dctl-chips" aria-label="Network">{networks.map((w) => chip(filter.network === w.id, w.label, () => onFilter({ ...filter, network: filter.network === w.id ? null : w.id })))}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function NoMatch({ filter, onClear }: { filter: DeviceFilter; onClear: () => void }) {
  if (!isFiltered(filter)) return null
  return (
    <p className="p-device-empty">No devices match <button type="button" className="p-unk-btn" onClick={onClear}>Clear filters</button></p>
  )
}
