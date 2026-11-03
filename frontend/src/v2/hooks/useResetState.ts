import { useState, type Dispatch, type SetStateAction } from 'react'

/** State that goes back to `initial` whenever `key` changes (default: whenever `initial` does). Adjusts during render, no effect. */
export function useResetState<T>(initial: T, key: unknown = initial): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(initial)
  const [prev, setPrev] = useState(key)
  if (!Object.is(prev, key)) {
    setPrev(key)
    setState(initial)
  }
  return [state, setState]
}
