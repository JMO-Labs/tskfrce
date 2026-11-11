import { SegmentedControl } from '@mantine/core'

import { STYLE_LABEL } from './format'
import type { Style } from './types'
import s from './presets.module.css'

const DATA = (Object.keys(STYLE_LABEL) as Style[]).map((value) => ({ value, label: STYLE_LABEL[value] }))

export function StyleSeg({ value, onChange, label }: { value: Style; onChange: (style: Style) => void; label: string }) {
  return <SegmentedControl className={s.seg} fullWidth data={DATA} value={value} onChange={(v) => onChange(v as Style)} aria-label={label} />
}
