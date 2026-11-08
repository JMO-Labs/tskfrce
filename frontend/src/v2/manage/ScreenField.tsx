import { useId, type FocusEvent } from 'react'

export interface FieldMsg { text: string; tone: 'error' | 'hint' }

/** A number field that saves when it loses focus (or on Enter). The message is linked with aria-describedby. */
export function ScreenField({ label, name = label, unit, value, onChange, onCommit, msg, placeholder }: {
  label: string; name?: string; unit?: string; value: string; onChange: (v: string) => void; onCommit: (e: FocusEvent<HTMLInputElement>) => void; msg?: FieldMsg; placeholder?: string
}) {
  const id = useId()
  const input = (
    <input
      id={id}
      className={unit ? undefined : 'pk-input st-num'}
      aria-label={name}
      inputMode="numeric"
      placeholder={placeholder}
      value={value}
      aria-invalid={!!msg}
      aria-describedby={msg ? `${id}-msg` : undefined}
      onChange={(e) => onChange(e.currentTarget.value)}
      onBlur={onCommit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
  return (
    <div className="pk-field">
      <label className="pk-label" htmlFor={id}>{label}</label>
      {unit ? <span className="pk-input rw-unit st-num">{input}<span aria-hidden="true">{unit}</span></span> : input}
      {msg && <span id={`${id}-msg`} className={msg.tone === 'error' ? 'pk-error' : 'pk-hint'}>{msg.text}</span>}
    </div>
  )
}
