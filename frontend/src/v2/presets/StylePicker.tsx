import { useId } from 'react'

import type { Style } from './types'
import s from './presets.module.css'

const OPTIONS: Array<{ value: Style; title: string; sub: string; rec?: boolean }> = [
  { value: 'relaxed', title: 'Relaxed', sub: 'Light chores, more screen time, kids are trusted' },
  { value: 'balanced', title: 'Balanced', sub: 'Chores first, then internet', rec: true },
  { value: 'strict', title: 'Strict', sub: 'More chores, less screen time, every chore checked' },
]

export function StylePicker({ value, onChange }: { value: Style | null; onChange: (style: Style) => void }) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label="How strict?">
      {OPTIONS.map((o) => (
        <label key={o.value} className={`${s.style} ${value === o.value ? s.on : ''}`}>
          <input type="radio" className={s.radio} name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.rec && <span className={s.rec}>Most families</span>}
          <b>{o.title}</b>
          <small>{o.sub}</small>
        </label>
      ))}
    </div>
  )
}
