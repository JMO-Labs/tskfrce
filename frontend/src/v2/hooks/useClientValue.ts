import { useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}

/** A browser-only value that is `server` during SSR/hydration and `get()` after. `get` must return a stable value. */
export function useClientValue<T>(get: () => T, server: T): T {
  return useSyncExternalStore(noSubscribe, get, () => server)
}
