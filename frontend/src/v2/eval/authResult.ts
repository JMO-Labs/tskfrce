import { track } from './track'

export type AuthStep = 'login' | 'register' | 'join' | 'reset_pin' | 'forgot_pin'
export type AuthResult = 'ok' | 'fail_pin' | 'fail_code' | 'locked' | 'error'

/** Map a failed auth call to an enum result. `bad` is what a 400/401/403 means for this step. */
export function authResult(err: unknown, bad: 'fail_pin' | 'fail_code'): AuthResult {
  const status = (err as { status?: unknown } | null)?.status
  if (typeof status !== 'number') return 'error'
  if (status === 429) return 'locked'
  return [400, 401, 403, 404, 410, 422].includes(status) ? bad : 'error'
}

export const trackAuth = (step: AuthStep, result: AuthResult): void => track('auth', { step, result })
