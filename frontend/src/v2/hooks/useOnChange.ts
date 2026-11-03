import { useState } from 'react'

const UNSET = Symbol('unset')

/** Runs `onChange` during render when `value` differs from the previous render's (and on the first one).
 *  For "when this prop changes, set some state", without an effect. `onChange` should only set state. */
export function useOnChange<T>(value: T, onChange: (v: T) => void) {
  const [prev, setPrev] = useState<T | typeof UNSET>(UNSET)
  if (!Object.is(prev, value)) {
    setPrev(value)
    onChange(value)
  }
}
