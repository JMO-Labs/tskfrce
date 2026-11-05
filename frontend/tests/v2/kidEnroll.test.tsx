import { beforeEach, describe, expect, test } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { KidPage } from '@/v2/kid/KidPage'
import { api } from '@/v2/api'
import { AlertsMoved } from '@/v2/kid/AlertsMoved'
import { alertsMoved } from '@/v2/kid/movedFlag'
import { clearDevice, refreshKid, removedMsg, saveAlert, saveDevice, saveKid } from '@/v2/kid/kidDevice'
import { fridgeTheme } from '@/v2/theme'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const fetchMock = jest.fn()
const reply = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) })
const paths = () => fetchMock.mock.calls.map((c) => String(c[0]).replace('/api/proxy', ''))
const kid = { id: 3, full_name: 'Ana', avatar: '🦊' }
const enrolled = { access_token: 'acc', device_token: 'dev', kid, alert: null }
const today = { locked: false, points_balance: 0, chores: [{ id: 7, title: 'Dishes', points: 5, state: 'todo' }] }

function routes(r: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    const p = String(url).replace('/api/proxy', '')
    const h = r[`${init?.method ?? 'GET'} ${p}`]
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

beforeEach(() => {
  localStorage.clear()
  clearDevice()
  fetchMock.mockReset()
  global.fetch = fetchMock as never
  window.history.replaceState(null, '', '/kid')
  window.matchMedia = (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never
})

describe('kid enrollment', () => {
  test('scanning a code enrolls before whoami, welcomes, then shows today', async () => {
    window.history.replaceState(null, '', '/kid#enroll=tok')
    routes({ 'POST /kid/enroll': () => reply(200, enrolled), 'GET /kid/today': () => reply(200, today) })
    renderKid()
    expect(await screen.findByText(/You're in, Ana!/)).toBeInTheDocument()
    expect(paths()[0]).toBe('/kid/enroll')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'tok' })
    expect(paths().indexOf('/kid/whoami')).not.toBe(0) // the code is redeemed first
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('button', { name: /^Open Dishes/ })).toBeInTheDocument()
    expect(window.location.hash).toBe('')
  })

  test('a remount keeps the name from the stored kid', async () => {
    window.history.replaceState(null, '', '/kid#enroll=tok')
    routes({ 'POST /kid/enroll': () => reply(200, enrolled), 'GET /kid/today': () => reply(200, today) })
    const first = renderKid()
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
    first.unmount()
    renderKid()
    await userEvent.click(await screen.findByRole('button', { name: /^Me/ }))
    expect((await screen.findAllByText(/Ana/)).length).toBeGreaterThan(0)
  })

  test('an expired code shows the server message and no picker', async () => {
    window.history.replaceState(null, '', '/kid#enroll=old')
    routes({ 'POST /kid/enroll': () => reply(410, { detail: 'This code has expired or was already used. Ask a parent for a new one.' }) })
    renderKid()
    expect(await screen.findByText(/expired or was already used/)).toBeInTheDocument()
    expect(screen.queryByText('Who is this?')).toBeNull()
    expect(paths()).not.toContain('/kid/whoami')
  })

  test('refresh failure clears the device', async () => {
    window.history.replaceState(null, '', '/kid#enroll=tok')
    routes({
      'POST /kid/enroll': () => reply(200, enrolled),
      'GET /kid/today': () => reply(401, { detail: 'expired' }),
      'GET /kid/celebrations': () => reply(401, { detail: 'expired' }),
      'POST /kid/session': () => reply(401, { detail: 'This phone was removed. Ask a parent for a new code.' }),
    })
    renderKid()
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
    expect(await screen.findByText('This phone was removed. Ask a parent for a new code.')).toBeInTheDocument()
    expect(paths().filter((p) => p === '/kid/session')).toHaveLength(1)
    expect(localStorage.getItem('task4ce-kid-device')).toBeNull()
    expect(screen.queryByText('Who is this?')).toBeNull()
  })

  test('a transient refresh failure keeps the device and offers a retry', async () => {
    window.history.replaceState(null, '', '/kid#enroll=tok')
    routes({
      'POST /kid/enroll': () => reply(200, enrolled),
      'GET /kid/today': () => reply(401, { detail: 'expired' }),
      'GET /kid/celebrations': () => reply(401, { detail: 'expired' }),
      'POST /kid/session': () => reply(503, { detail: 'down' }),
    })
    renderKid()
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(localStorage.getItem('task4ce-kid-device')).toBe('dev')
    expect(screen.queryByText('Who is this?')).toBeNull()
  })

  test('retry on a revoked phone shows the removed gate', async () => {
    window.history.replaceState(null, '', '/kid#enroll=tok')
    let status = 503
    routes({
      'POST /kid/enroll': () => reply(200, enrolled),
      'GET /kid/today': () => reply(401, { detail: 'expired' }),
      'GET /kid/celebrations': () => reply(401, { detail: 'expired' }),
      'POST /kid/session': () => reply(status, { detail: 'This phone was removed. Ask a parent for a new code.' }),
    })
    renderKid()
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await screen.findByRole('button', { name: 'Retry' })
    status = 401
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('This phone was removed. Ask a parent for a new code.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  test('a removed-phone message survives a reload', async () => {
    saveDevice('dev')
    routes({ 'POST /kid/session': () => reply(401, { detail: 'This phone was removed. Ask a parent for a new code.' }) })
    expect(await refreshKid()).toBe(false)
    expect(removedMsg()).toMatch(/phone was removed/)
    expect(localStorage.getItem('task4ce-kid-removed')).toMatch(/phone was removed/)
    saveDevice('new')
    expect(removedMsg()).toBeNull()
  })

  test('a changed alert topic shows the reconnect banner', async () => {
    saveDevice('dev')
    saveKid(kid)
    saveAlert({ server: 'https://ntfy.sh', topic: 'a' })
    routes({ 'POST /kid/session': () => reply(200, { access_token: 'acc', kid, alert: { server: 'https://ntfy.sh', topic: 'b' } }) })
    await refreshKid()
    expect(alertsMoved()).toBe(true)
    render(<AlertsMoved />)
    expect(screen.getByRole('link', { name: /alerts moved/i })).toHaveAttribute('href', 'ntfy://ntfy.sh/b?display=t%40sk4ce')
    await userEvent.click(screen.getByRole('link'))
    expect(alertsMoved()).toBe(false)
  })

  test('a parent request 401 never calls /kid/session', async () => {
    saveDevice('dev')
    localStorage.setItem('refresh_token', 'r')
    routes({ 'GET /today': () => reply(401, { detail: 'nope' }), 'POST /auth/refresh': () => reply(401, { detail: 'bad' }) })
    await expect(api('/today')).rejects.toThrow()
    await waitFor(() => expect(paths()).not.toContain('/kid/session'))
  })
})
