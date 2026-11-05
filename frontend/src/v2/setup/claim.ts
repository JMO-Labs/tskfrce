import type { SetupStatus } from '@/v2/types'

export const CLAIM_KEY = 'task4ce-claim'
const ALPHABET = /[^0-9A-HJKMNP-TV-Z]/g // Crockford base32

/** Upper-case, O→0, I/L→1, drop everything else, 10 max (matches the backend). */
const clean = (raw: string) =>
  raw.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(ALPHABET, '').slice(0, 10)

/** Shown grouped as the user types: K7M2Q-XA9PB. */
export const groupClaim = (raw: string): string => {
  const c = clean(raw)
  return c.length > 5 ? `${c.slice(0, 5)}-${c.slice(5)}` : c
}

export const readClaim = (): string | null => {
  try {
    return sessionStorage.getItem(CLAIM_KEY)
  } catch {
    return null
  }
}

export const clearClaim = (): void => {
  try {
    sessionStorage.removeItem(CLAIM_KEY)
  } catch {}
}

/** Browser only. Moves #claim=… from the address bar into sessionStorage, once. */
export function captureClaim(): null {
  if (typeof window === 'undefined') return null // the useState initializer also runs on the server
  const m = /(?:^#|&)claim=([^&]*)/.exec(window.location.hash)
  if (!m) return null
  try {
    const code = clean(decodeURIComponent(m[1]))
    if (code) sessionStorage.setItem(CLAIM_KEY, code)
  } catch {}
  history.replaceState(null, '', window.location.pathname + window.location.search)
  return null
}

/** A box that is already set up must not keep a stored code. */
export const settleClaim = (status?: SetupStatus): void => {
  if (status?.needed === false) clearClaim()
}
