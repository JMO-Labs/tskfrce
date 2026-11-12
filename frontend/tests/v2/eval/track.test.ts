import { api, ApiError, AuthError, KID_TOKEN_KEY } from '@/v2/api'
import { tokenManager } from '@/services/tokenManager'
import { _resetTrack, track } from '@/v2/eval/track'
import { errorKind, noteError, recentErrors } from '@/v2/eval/errors'

jest.mock('@/v2/api', () => ({ ...jest.requireActual('@/v2/api'), api: jest.fn() }))
jest.mock('@/services/tokenManager', () => ({ tokenManager: { getAccessToken: jest.fn() } }))

const apiMock = api as jest.Mock
const tok = tokenManager.getAccessToken as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  apiMock.mockResolvedValue(undefined)
  tok.mockReturnValue(null)
  localStorage.clear()
  _resetTrack()
})

const sent = () => apiMock.mock.calls.map((c) => c[1].body)

test('buffers before login then flushes in order', () => {
  track('error_shown', { route: 'A' })
  track('error_shown', { route: 'B' })
  expect(apiMock).not.toHaveBeenCalled()
  tok.mockReturnValue('t')
  track('error_shown', { route: 'C' })
  expect(sent().map((b) => b.props.route)).toEqual(['A', 'B', 'C'])
  expect(apiMock.mock.calls[0]).toEqual(['/eval/event', expect.objectContaining({ method: 'POST' })])
})

test('buffer caps at 20', () => {
  for (let i = 0; i < 25; i++) track('error_shown', { route: String(i) })
  tok.mockReturnValue('t')
  track('wizard_done')
  expect(apiMock).toHaveBeenCalledTimes(21)
  expect(sent()[0].props.route).toBe('5')
})

test('pre-login auth/screen_view/wifi feature go to anon-event, not the buffer', () => {
  track('auth', { step: 'login', result: 'fail_pin' })
  track('screen_view', { route: '/login' })
  track('feature', { area: 'wifi', action: 'start' })
  expect(apiMock.mock.calls.map((c) => c[0])).toEqual(['/eval/anon-event', '/eval/anon-event', '/eval/anon-event'])
  expect(sent()[0]).toEqual({ name: 'auth', props: { step: 'login', result: 'fail_pin' } })
  tok.mockReturnValue('t')
  apiMock.mockClear()
  track('wizard_done')
  expect(apiMock).toHaveBeenCalledTimes(1)
})

test('pre-login non-wifi feature is buffered, not sent anon', () => {
  track('feature', { area: 'goals', action: 'open' })
  expect(apiMock).not.toHaveBeenCalled()
})

test('logged-in auth event uses the normal endpoint', () => {
  tok.mockReturnValue('t')
  track('auth', { step: 'login', result: 'ok' })
  expect(apiMock.mock.calls[0][0]).toBe('/eval/event')
})

test('kid without token drops', () => {
  track('screen_view', { route: '/kid' }, { kid: true })
  localStorage.setItem(KID_TOKEN_KEY, 'k')
  track('screen_view', { route: '/kid' }, { kid: true })
  expect(apiMock).toHaveBeenCalledTimes(1)
  expect(apiMock.mock.calls[0][1].kid).toBe(true)
})

test('track swallows auth error', async () => {
  tok.mockReturnValue('t')
  apiMock.mockRejectedValue(new AuthError('no'))
  expect(() => track('wizard_done')).not.toThrow()
  await Promise.resolve()
})

test('errorKind', () => {
  expect(errorKind(new ApiError(404, 'x'))).toBe('http_404')
  expect(errorKind(new TypeError())).toBe('network')
  expect(errorKind('boom')).toBe('other')
})

test('recentErrors keeps last 5', () => {
  for (let i = 1; i <= 7; i++) noteError(new ApiError(400 + i, 'x'))
  expect(recentErrors()).toEqual(['http_403', 'http_404', 'http_405', 'http_406', 'http_407'])
})
