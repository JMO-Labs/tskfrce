import { useState } from 'react'
import type { Goal } from '@/v2/goalTypes'
import { MoreMenu } from '@/v2/parent/MoreMenu'
import { ConfirmDelete } from './ConfirmDelete'

export const num = (n: number | null) => (n ?? 0).toLocaleString()
const pct = (g: Goal) => Math.min(100, g.target ? Math.round((g.saved / g.target) * 100) : 0)
export const nameOf = (g: Goal) => (g.emoji ? `${g.emoji} ${g.name}` : g.name)

export function Mini({ g }: { g: Goal }) {
  return <div className="mini" role="img" aria-label={`${pct(g)}% saved`}><i style={{ width: `${pct(g)}%` }} /></div>
}

/** A pill that opens a small number input; `go` gets the number. */
export function NumberAsk({ label, open, onClose, button, go }: { label: string; open: boolean; onClose: () => void; button: string; go: (n: number) => void }) {
  const [v, setV] = useState('')
  if (!open) return null
  return (
    <div className="gl-ask">
      <input className="pk-input" type="number" min={1} inputMode="numeric" aria-label={label} value={v} onChange={(e) => setV(e.currentTarget.value)} />
      <button type="button" className="pill dark" disabled={!(Number(v) > 0)} onClick={() => { go(Number(v)); setV(''); onClose() }}>{button}</button>
    </div>
  )
}

/** A family or kid goal row: "…" menu (Change price, Remove), optional chip-in pill, price entry and remove confirm. */
export function GoalRow({ g, kid, chip, onPrice, onRemove, onChip }: { g: Goal; kid?: boolean; chip?: boolean; onPrice: (n: number) => void; onRemove: () => void; onChip?: (n: number) => void }) {
  const [ask, setAsk] = useState<'price' | 'chip' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const items = [
    { label: 'Change price', icon: 'edit', onClick: () => setAsk('price'), takesFocus: true },
    { label: 'Remove', icon: 'delete', tone: 'red' as const, onClick: () => setConfirm(true), divider: true },
  ]
  return (
    <div>
      <div className="li">
        <div>{kid ? `${g.kid_name} · ` : ''}{nameOf(g)}<Mini g={g} /></div>
        <div className="gl-r">
          {chip ? <button type="button" className="pill" onClick={() => setAsk(ask === 'chip' ? null : 'chip')}>+ Chip in</button> : <small>{num(g.saved)} / {num(g.target)}</small>}
          <MoreMenu label={`More for ${g.name}`} items={items} />
        </div>
      </div>
      <NumberAsk label="Price" open={ask === 'price'} onClose={() => setAsk(null)} button="Save price" go={onPrice} />
      {onChip && <NumberAsk label="Amount" open={ask === 'chip'} onClose={() => setAsk(null)} button="Add" go={onChip} />}
      <ConfirmDelete opened={confirm} title={`Remove ${g.name}?`} body="Points saved so far go back to the kids who saved them." confirmLabel="Remove" onConfirm={onRemove} onClose={() => setConfirm(false)} />
    </div>
  )
}
