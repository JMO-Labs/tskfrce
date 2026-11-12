import { ApiError, AuthError } from '@/v2/api'
import { track } from '@/v2/eval/track'
import { authResult, trackAuth } from '@/v2/eval/authResult'

jest.mock('@/v2/eval/track', () => ({ track: jest.fn() }))

test('authResult maps errors to enums', () => {
  expect(authResult(new AuthError('x'), 'fail_pin')).toBe('fail_pin')
  expect(authResult(new ApiError(400, 'x'), 'fail_code')).toBe('fail_code')
  expect(authResult(new ApiError(429, 'x'), 'fail_pin')).toBe('locked')
  expect(authResult(new ApiError(500, 'x'), 'fail_pin')).toBe('error')
  expect(authResult(new TypeError('net'), 'fail_pin')).toBe('error')
})

test('trackAuth emits auth', () => {
  trackAuth('login', 'ok')
  expect(track).toHaveBeenCalledWith('auth', { step: 'login', result: 'ok' })
})
