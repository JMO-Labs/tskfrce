import { useState } from 'react'
import { Popover } from '@mantine/core'
import type { Kid } from '@/v2/types'
import { initial, nameOf } from '@/v2/manage/choreMeta'
import { Icon } from './Icon'
import { motionProps } from './reduceMotion'

export interface PickerExtra { value: string; label: string; icon?: string }
interface Props {
  kids: Kid[]; value: string[]; onChange: (v: string[]) => void; label: string
  single?: boolean; extras?: PickerExtra[]; busy?: boolean; disabled?: boolean
  variant?: 'pills' | 'pop'; placeholder?: string
}

/** Pick kids (and exclusive extras such as Guest). Pills inline, or one button with a pop-over. */
export function KidPicker({ kids, value, onChange, label, single, extras = [], busy, disabled, variant = 'pills', placeholder = 'Owner' }: Props) {
  const [open, setOpen] = useState(false)
  const isExtra = (v: string) => extras.some((x) => x.value === v)
  const pick = (v: string) => {
    if (busy) return
    if (isExtra(v)) onChange(value.includes(v) ? [] : [v])
    else if (single) onChange([v])
    else onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value.filter((x) => !isExtra(x)), v])
  }
  const items = [
    ...kids.map((k) => ({ value: String(k.id), label: nameOf(k), av: initial(nameOf(k)), icon: undefined as string | undefined, extra: false })),
    ...extras.map((x) => ({ value: x.value, label: x.label, av: undefined as string | undefined, icon: x.icon, extra: true })),
  ]
  const btn = (i: (typeof items)[number], cls: string) => (
    <button key={i.value} type="button" className={cls} aria-pressed={value.includes(i.value)} disabled={disabled} aria-disabled={busy || undefined}
      onClick={() => { pick(i.value); if (variant === 'pop' && !busy) setOpen(false) }}>
      {i.av && <span className="pk-av" aria-hidden="true">{i.av}</span>}
      {i.icon && <Icon name={i.icon} size={16} />}
      {i.label}
    </button>
  )
  if (variant === 'pills') return <div className="pk-pills" role="group" aria-label={label}>{items.map((i) => btn(i, 'pk-pill'))}</div>

  const current = items.filter((i) => value.includes(i.value)).map((i) => i.label).join(', ') || placeholder
  return (
    <Popover opened={open} onChange={setOpen} withinPortal position="bottom-start" returnFocus transitionProps={motionProps()}>
      <Popover.Target>
        <button type="button" className="p-btn p-pk-pop" aria-label={label} aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
          {current}<Icon name="expand_more" size={16} />
        </button>
      </Popover.Target>
      <Popover.Dropdown className="p-pop">
        <div className="pk-pills p-pk-list" role="group" aria-label={label}>
          {items.filter((i) => !i.extra).map((i) => btn(i, 'pk-pill'))}
          {extras.length > 0 && kids.length > 0 && <hr className="p-pk-div" />}
          {items.filter((i) => i.extra).map((i) => btn(i, 'pk-pill'))}
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}
