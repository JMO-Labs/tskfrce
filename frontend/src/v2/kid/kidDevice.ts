import { writeToken } from './tokenStore'
import { setAlertsMoved } from './movedFlag'
import type { KidAlert, KidIdentity } from '../types/enroll'

export const DEVICE_KEY = 'task4ce-kid-device'
export const KID_KEY = 'task4ce-kid-device-kid'
export const ALERT_KEY = 'task4ce-kid-alert'

// storage can be blocked: the phone then just won't stay signed in
const get = (k: string): string | null => {
  try { return localStorage.getItem(k) } catch { return null }
}
const set = (k: string, v: string | null) => {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {}
}
const json = <T,>(k: string): T | null => {
  try { return JSON.parse(get(k) ?? 'null') } catch { return null }
}

export const deviceToken = (): string | null => get(DEVICE_KEY)
export const saveDevice = (t: string): void => {
  set(REMOVED_KEY, null)
  set(DEVICE_KEY, t)
}
export const saveKid = (k: KidIdentity): void => set(KID_KEY, JSON.stringify(k))
export const deviceKid = (): KidIdentity | null => json<KidIdentity>(KID_KEY)
export const clearDevice = (): void => [DEVICE_KEY, KID_KEY, ALERT_KEY].forEach((k) => set(k, null))

export const alertStored = (): KidAlert | null => json<KidAlert>(ALERT_KEY)

/** True when the stored topic was replaced by a different one (a phone was removed). */
export function saveAlert(a: KidAlert | null): boolean {
  const old = json<KidAlert>(ALERT_KEY)
  set(ALERT_KEY, a ? JSON.stringify(a) : null)
  return !!a && !!old && old.topic !== a.topic
}

/** ntfy app link: no kid name, `secure=false` only for http servers. */
export function alertLink({ server, topic }: KidAlert): string {
  const u = new URL(server)
  return `ntfy://${u.host}/${topic}?display=t%40sk4ce${u.protocol === 'http:' ? '&secure=false' : ''}`
}

/** Browser only. Reads #enroll=… and strips it from the address bar right away. */
export function takeEnrollToken(): string | null {
  if (typeof window === 'undefined') return null // the lazy useState also runs on the server
  const m = /(?:^#|&)enroll=([^&]*)/.exec(window.location.hash)
  if (!m) return null
  history.replaceState(null, '', '/kid')
  try { return decodeURIComponent(m[1]) || null } catch { return null }
}

const REMOVED_KEY = 'task4ce-kid-removed'
export const removedMsg = (): string | null => get(REMOVED_KEY)

let inflight: Promise<boolean> | null = null
async function refresh(): Promise<boolean> {
  const device_token = deviceToken()
  if (!device_token) return false
  try {
    const res = await fetch('/api/proxy/kid/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_token }),
    })
    if (res.status === 401) {
      const d = await res.json().catch(() => null)
      clearDevice()
      set(REMOVED_KEY, typeof d?.detail === 'string' ? d.detail : null)
      return false
    }
    if (!res.ok) return false
    const r = await res.json()
    writeToken(r.access_token, r.kid.id)
    saveKid(r.kid)
    if (saveAlert(r.alert)) setAlertsMoved(true)
    return true
  } catch {
    return false // offline: keep the device, try again later
  }
}

/** Trade the device token for a fresh session. One call at a time: callers share the promise. */
export function refreshKid(): Promise<boolean> {
  inflight ??= refresh().finally(() => (inflight = null))
  return inflight
}
