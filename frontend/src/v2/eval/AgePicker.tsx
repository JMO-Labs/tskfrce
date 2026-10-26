import { useState, type ReactNode } from 'react'
import { Input, SegmentedControl } from '@mantine/core'
import { api } from '@/v2/api'
import { useEvalStatus } from './useEvalStatus'

export const AGE_OPTIONS = [
  { value: '≤7', label: '7 or under' },
  { value: '8–10', label: '8–10' },
  { value: '11–13', label: '11–13' },
  { value: '14+', label: '14 or older' },
]

/** Optional age range for anonymous stats. Renders nothing (and save does nothing) unless stats are on. */
export function useAgePicker(look: 'wizard' | 'parent' = 'wizard'): { picker: ReactNode; save: (kidId: number) => void } {
  const stats = useEvalStatus().data.stats
  const [pick, setPick] = useState('')
  const save = (kidId: number) => {
    if (!stats || !pick) return
    api(`/eval/kids/${kidId}/age`, { method: 'PUT', body: { age_group: pick } }).catch(() => {})
    setPick('')
  }
  const LABEL = 'Age range (for anonymous stats)'
  const parentPicker = (
    <div className="pk-field" role="group" aria-label={LABEL}>
      <span className="pk-label">{LABEL}</span>
      <div className="pk-pills">
        {AGE_OPTIONS.map((o) => (
          <button key={o.value} type="button" className="pk-pill" aria-pressed={pick === o.value} onClick={() => setPick(pick === o.value ? '' : o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <span className="pk-hint">Optional. Only the range is kept, never a birth date.</span>
    </div>
  )
  const picker = !stats ? null : look === 'parent' ? parentPicker : (
    <Input.Wrapper mt="md" label="Age range (for anonymous stats)" description="Optional. Only the range is kept, never a birth date.">
      <SegmentedControl mt={6} fullWidth aria-label="Age range (for anonymous stats)" data={AGE_OPTIONS} value={pick} onChange={setPick} />
    </Input.Wrapper>
  )
  return { picker, save }
}
