import { useState } from 'react'
import dayjs from 'dayjs'
import { useKidPenalties, usePenaltyAction } from '@/v2/hooks/usePenalties'
import { Icon } from '@/v2/parent/Icon'
import type { Penalty } from '@/v2/penaltyTypes'
import { ConfirmDelete } from './ConfirmDelete'

const ICON = { points: 'stars', screen: 'timer', block: 'block' } as const
const CHIPS = [['1 hour', 60], ['1 day', 1440]] as const

/** "Half" shorten: half of what is left, whole minutes, at least 15. */
export const halfLeft = (endsAt: string | null, now = new Date()): number =>
  Math.max(15, Math.round(dayjs(endsAt).diff(now, 'minute', true) / 2))

function when(p: Penalty): string | null {
  if (p.makeup.length) return `${p.makeup.filter((m) => m.status === 'done').length} of ${p.makeup.length} done`
  if (p.kind !== 'block' || !p.ends_at) return null
  const end = dayjs(p.ends_at)
  return `until ${end.format(end.isSame(dayjs(), 'day') ? 'h:mm a' : 'ddd h:mm a')}`
}

function Row({ p, name }: { p: Penalty; name: string }) {
  const [open, setOpen] = useState(false)
  const [undo, setUndo] = useState(false)
  const act = usePenaltyAction()
  const run = (action: 'shorten' | 'forgive' | 'cancel', minutes?: number) => act.mutate({ id: p.id, action, minutes })
  const sub = when(p)
  return (
    <div className="p-pen-edit">
      <button type="button" className="p-pen-sum" aria-expanded={open} onClick={() => setOpen(!open)} style={{ width: '100%', background: 'none', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
        <span><Icon name={ICON[p.kind]} size={16} /> {p.summary}</span>
        {sub && <em>{sub}</em>}
      </button>
      {open && (
        <div>
          {p.kind === 'block' && (
            <>
              <div className="p-pen-lbl">Shorten</div>
              <div className="p-pen-chips">
                {CHIPS.map(([l, m]) => <button key={l} type="button" className="p-pen-chip" disabled={act.isPending} onClick={() => run('shorten', m)}>{l}</button>)}
                <button type="button" className="p-pen-chip" disabled={act.isPending} onClick={() => run('shorten', halfLeft(p.ends_at))}>Half</button>
              </div>
            </>
          )}
          <div className="pk-actions" style={{ marginTop: 8 }}>
            <button type="button" className="p-btn" disabled={act.isPending} onClick={() => run('forgive')}>Forgive</button>
            <button type="button" className="p-btn" data-variant="red" disabled={act.isPending} onClick={() => setUndo(true)}>Cancel</button>
          </div>
        </div>
      )}
      <ConfirmDelete opened={undo} title="Undo this penalty?" body={`Undo this penalty? ${name} gets back what was taken.`} confirmLabel="Undo" onConfirm={() => run('cancel')} onClose={() => setUndo(false)} />
    </div>
  )
}

/** Active penalties on the kid page; nothing when there are none. */
export function PenaltyList({ kidId, name }: { kidId: number; name: string }) {
  const { data } = useKidPenalties(kidId)
  const active = Array.isArray(data) ? data.filter((p) => p.status === 'active') : []
  if (!active.length) return null
  return (
    <section className="p-pen-sheet" aria-label="Penalties">
      <div className="p-pen-lbl">Penalties</div>
      {active.map((p) => <Row key={p.id} p={p} name={name} />)}
    </section>
  )
}
