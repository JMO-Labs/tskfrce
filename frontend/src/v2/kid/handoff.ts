import { api, ApiError } from '../api'
import type { KidEnrolled } from '../types/enroll'
import { saveAlert, saveDevice, saveKid } from './kidDevice'
import { writeToken } from './tokenStore'

/** Trade a typed hand-off code for this phone's own sign-in (same saves as a scanned QR). */
export async function redeemHandoff(code: string): Promise<void> {
  const r = await api<KidEnrolled>('/kid/handoff', { method: 'POST', body: { code } })
  writeToken(r.access_token, r.kid.id)
  saveDevice(r.device_token)
  saveKid(r.kid)
  saveAlert(r.alert)
}

/** What the kid sees when a code fails. */
export const handoffError = (e: unknown): string =>
  e instanceof ApiError && e.status === 429
    ? 'Too many tries. Wait a minute and try again.'
    : e instanceof ApiError
      ? e.detail
      : "Can't reach your box. Try again."
