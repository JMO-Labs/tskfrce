/** Optional "Birthday (month/year)" input. Value is "YYYY-MM" or "" (not set). */
export const toMonthValue = (m?: number | null, y?: number | null) =>
  m && y ? `${y}-${String(m).padStart(2, '0')}` : ''

/** "YYYY-MM" -> the API pair; "" -> both null (clears). Half-typed values are rejected. */
export function fromMonthValue(v: string): { birth_month: number | null; birth_year: number | null } | undefined {
  if (v === '') return { birth_month: null, birth_year: null }
  const m = /^(\d{4})-(\d{2})$/.exec(v)
  return m ? { birth_month: Number(m[2]), birth_year: Number(m[1]) } : undefined
}

interface Props {
  value: string
  onChange: (v: string) => void
  className?: string
}

export function BirthdayField({ value, onChange, className = 'pk-input kd-in' }: Props) {
  return (
    <input
      type="month"
      className={className}
      aria-label="Birthday (month/year), optional"
      min="1990-01"
      max={new Date().toISOString().slice(0, 7)}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  )
}
