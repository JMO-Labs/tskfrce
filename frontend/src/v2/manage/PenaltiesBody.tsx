import { useState } from 'react'
import { WhatLine, EarnLine, type PenLine } from '@/v2/today/PenaltyLines'
import type { PenaltyDraft, PenaltySize, SizeKey } from '@/v2/penaltyTypes'
import type { Family } from '@/v2/types'
import { Setr, Sw, type SaveFamily } from './FamilyRows'

export const MAX_MAKEUP_LIST = 12
const SIZES: [SizeKey, string][] = [['small', 'Small'], ['medium', 'Medium'], ['big', 'Big']]

export const penaltiesLine = (f: Family) => (f.penalties_enabled ? 'On · 3 sizes' : 'Off')

const toDraft = (s: PenaltySize): PenaltyDraft => ({ ...s, reason: '', makeup: [] })

function SizeRow({ name, size, save }: { name: string; size: PenaltySize; save: (s: PenaltySize) => void }) {
  const [open, setOpen] = useState<PenLine | null>(null)
  const change = (p: Partial<PenaltyDraft>) => {
    const next = { ...toDraft(size), ...p }
    save({ kind: next.kind, amount: next.amount, earn_back: next.earn_back })
  }
  const draft = toDraft(size)
  return (
    <div className="ch-setl" role="group" aria-label={`${name} penalty`}>
      <b>{name}</b>
      <WhatLine draft={draft} open={open === 'what'} onOpen={() => setOpen('what')} onChange={change} />
      <EarnLine draft={draft} makeupChores={[]} open={open === 'earn'} onOpen={() => setOpen('earn')} onChange={change} />
    </div>
  )
}

/** Settings > Family > Penalties: the switch first; sizes and the make-up list only when on. */
export function PenaltiesBody({ fam, save }: { fam: Family; save: SaveFamily }) {
  const [text, setText] = useState('')
  const list = fam.makeup_chores ?? []
  const add = () => {
    const v = text.trim()
    if (!v || list.includes(v) || list.length >= MAX_MAKEUP_LIST) return
    setText('')
    void save((f) => ({ makeup_chores: [...(f.makeup_chores ?? []), v] }))
  }
  return (
    <div className="ch-setl">
      <Setr label="Penalties">
        <Sw label="Penalties" checked={fam.penalties_enabled} onChange={(v) => void save({ penalties_enabled: v })} />
      </Setr>
      {!fam.penalties_enabled && <span className="pk-hint ch-hint">Take something away, say why, and let them earn part back.</span>}
      {fam.penalties_enabled && (
        <>
          {SIZES.map(([k, name]) => (
            <SizeRow
              key={k}
              name={name}
              size={fam.penalty_sizes[k]}
              save={(s) => void save((f) => ({ penalty_sizes: { ...f.penalty_sizes, [k]: s } }))}
            />
          ))}
          <b>Make-up chores</b>
          <div className="p-pen-chips">
            {list.map((c) => (
              <button key={c} type="button" className="p-pen-chip" aria-label={`Remove ${c}`} onClick={() => void save((f) => ({ makeup_chores: (f.makeup_chores ?? []).filter((x) => x !== c) }))}>
                {c} ×
              </button>
            ))}
          </div>
          {list.length < MAX_MAKEUP_LIST && (
            <div className="ch-setr fam-setr">
              <input className="pk-input" aria-label="New make-up chore" maxLength={60} value={text} onChange={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
              <button type="button" className="p-btn" onClick={add} disabled={!text.trim()}>Add</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
