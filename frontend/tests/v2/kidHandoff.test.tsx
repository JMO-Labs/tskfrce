import { beforeEach, describe, expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { KidPage } from '@/v2/kid/KidPage'
import { clearDevice, deviceToken } from '@/v2/kid/kidDevice'
import { fridgeTheme } from '@/v2/theme'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const fetchMock = jest.fn()
const reply = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) })
const kid = { id: 3, full_name: 'Ana', avatar: '🦊' }
const today = { locked: false, points_balance: 0, chores: [{ id: 7, title: 'Dishes', points: 5, state: 'todo' }] }
const GONE = 'This code has expired or was already used. Ask a parent for a new code.'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'

function routes(r: Record<string, () => unknown>) {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    const h = r[`${init?.method ?? 'GET'} ${String(url).replace('/api/proxy', '')}`]
    return h ? h() : reply(404, { detail: 'nope' })
  })
}
const renderKid = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider theme={fridgeTheme}>
        <KidPage />
      </MantineProvider>
    </QueryClientProvider>,
  )
const ua = (s: string) => Object.defineProperty(navigator, 'userAgent', { value: s, configurable: true })

beforeEach(() => {
  localStorage.clear()
  clearDevice()
  fetchMock.mockReset()
  global.fetch = fetchMock as never
  window.history.replaceState(null, '', '/kid')
  window.matchMedia = (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
})

const enrollWith = (agent: string) => {
  ua(agent)
  window.history.replaceState(null, '', '/kid#enroll=tok')
  routes({ 'POST /kid/enroll': () => reply(200, { access_token: 'a', device_token: 'd', kid, alert: null, handoff: 'AB3D-7KMN' }) })
  renderKid()
}

describe('hand-off code', () => {
  test('welcome shows the big code on an iPhone', async () => {
    enrollWith(IPHONE)
    expect(await screen.findByText('AB3D-7KMN')).toBeInTheDocument()
    expect(screen.getByText(/Works once, for 15 minutes/)).toBeInTheDocument()
    expect(screen.getByText('Add to Home Screen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  test('welcome hides the code on Android', async () => {
    enrollWith(ANDROID)
    await screen.findByText(/You're in, Ana!/)
    expect(screen.queryByText('AB3D-7KMN')).toBeNull()
  })

  describe('typing it in', () => {
    const gate = async () => {
      ua(IPHONE)
      routes({
        'GET /kid/whoami': () => reply(200, { device: false, kids: [] }),
        'GET /kid/today': () => reply(200, today),
      })
      renderKid()
      await userEvent.click(await screen.findByRole('button', { name: 'I have a code' }))
      return screen.getByPlaceholderText('XXXX-XXXX')
    }

    test('success signs in and shows today', async () => {
      const box = await gate()
      expect(box).toHaveAttribute('autocomplete', 'one-time-code')
      expect(box).toHaveAttribute('autocapitalize', 'characters')
      const base = fetchMock.getMockImplementation() as (u: string, i?: { method?: string }) => Promise<unknown>
      fetchMock.mockImplementation(async (u: string, i?: { method?: string }) =>
        String(u).endsWith('/kid/handoff') ? reply(200, { access_token: 'n', device_token: 'newdev', kid, alert: null }) : base(u, i),
      )
      await userEvent.type(box, 'ab3d7kmn')
      await userEvent.click(screen.getByRole('button', { name: 'Go' }))
      expect(await screen.findByRole('button', { name: /^Open Dishes/ })).toBeInTheDocument()
      const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/kid/handoff'))
      expect(JSON.parse(call[1].body)).toEqual({ code: 'ab3d7kmn' })
      expect(deviceToken()).toBe('newdev')
    })

    test('410 shows the server text', async () => {
      const box = await gate()
      const base = fetchMock.getMockImplementation() as (u: string, i?: { method?: string }) => Promise<unknown>
      fetchMock.mockImplementation(async (u: string, i?: { method?: string }) =>
        String(u).endsWith('/kid/handoff') ? reply(410, { detail: GONE }) : base(u, i),
      )
      await userEvent.type(box, 'AAAA-AAAA')
      await userEvent.click(screen.getByRole('button', { name: 'Go' }))
      expect(await screen.findByText(GONE)).toBeInTheDocument()
      expect(deviceToken()).toBeNull()
    })

    test('network failure shows the reach text and keeps the input', async () => {
      const box = await gate()
      const base = fetchMock.getMockImplementation() as (u: string, i?: { method?: string }) => Promise<unknown>
      fetchMock.mockImplementation(async (u: string, i?: { method?: string }) => {
        if (String(u).endsWith('/kid/handoff')) throw new TypeError('offline')
        return base(u, i)
      })
      await userEvent.type(box, 'AAAA-AAAA')
      await userEvent.click(screen.getByRole('button', { name: 'Go' }))
      expect(await screen.findByText("Can't reach your box. Try again.")).toBeInTheDocument()
      expect(screen.getByPlaceholderText('XXXX-XXXX')).toHaveValue('AAAA-AAAA')
    })

    test('the input keeps its value after a 410', async () => {
      const box = await gate()
      expect(box).toHaveAttribute('maxlength', '32')
      const base = fetchMock.getMockImplementation() as (u: string, i?: { method?: string }) => Promise<unknown>
      fetchMock.mockImplementation(async (u: string, i?: { method?: string }) =>
        String(u).endsWith('/kid/handoff') ? reply(410, { detail: GONE }) : base(u, i),
      )
      await userEvent.type(box, 'AAAA-AAAA')
      await userEvent.click(screen.getByRole('button', { name: 'Go' }))
      await screen.findByText(GONE)
      expect(screen.getByPlaceholderText('XXXX-XXXX')).toHaveValue('AAAA-AAAA')
    })

    test('429 shows the wait text', async () => {
      const box = await gate()
      const base = fetchMock.getMockImplementation() as (u: string, i?: { method?: string }) => Promise<unknown>
      fetchMock.mockImplementation(async (u: string, i?: { method?: string }) =>
        String(u).endsWith('/kid/handoff') ? reply(429, { detail: 'Too many tries. Wait 1 minute and try again.' }) : base(u, i),
      )
      await userEvent.type(box, 'AAAA-AAAA')
      await userEvent.click(screen.getByRole('button', { name: 'Go' }))
      expect(await screen.findByText('Too many tries. Wait a minute and try again.')).toBeInTheDocument()
    })
  })
})

describe('code entry on every gate', () => {
  test('iPhone not-set-up gate points at the code', async () => {
    ua(IPHONE)
    routes({ 'GET /kid/whoami': () => reply(200, { device: false, kids: [] }) })
    renderKid()
    expect(await screen.findByText('Have a code from your welcome screen? Tap I have a code.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I have a code' })).toBeInTheDocument()
  })

  test('Android not-set-up gate keeps the old text', async () => {
    ua(ANDROID)
    routes({ 'GET /kid/whoami': () => reply(200, { device: false, kids: [] }) })
    renderKid()
    expect(await screen.findByText("This device isn't set up yet. Ask a parent to add it.")).toBeInTheDocument()
  })

  test('the no-kids gate offers it', async () => {
    ua(ANDROID)
    routes({ 'GET /kid/whoami': () => reply(200, { device: true, kids: [] }) })
    renderKid()
    expect(await screen.findByText(/No kid is set up/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I have a code' })).toBeInTheDocument()
  })

  test('the picker and the PIN screen offer it', async () => {
    ua(ANDROID)
    const kids = [
      { id: 3, full_name: 'Ana', avatar: '🦊', has_pin: true },
      { id: 4, full_name: 'Bo', avatar: '🐻', has_pin: true },
    ]
    routes({ 'GET /kid/whoami': () => reply(200, { device: true, kids }) })
    renderKid()
    expect(await screen.findByText('Who is this?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I have a code' })).toBeInTheDocument()
    await userEvent.click(screen.getByText('Ana'))
    expect(await screen.findByText(/enter your PIN/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I have a code' })).toBeInTheDocument()
  })

  test('the removed-phone gate offers it', async () => {
    ua(ANDROID)
    localStorage.setItem('task4ce-kid-removed', 'This phone was removed. Ask a parent for a new code.')
    routes({ 'GET /kid/whoami': () => reply(200, { device: false, kids: [] }) })
    renderKid()
    expect(await screen.findByText(/phone was removed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I have a code' })).toBeInTheDocument()
  })
})
