import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { api } from '@/v2/api'
import { fridgeTheme } from '@/v2/theme'
import { KidPhonesPanel } from '@/v2/manage/KidPhonesPanel'
import type { Kid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ ...(jest.requireActual('@/v2/api') as object), api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string }) => Promise<unknown>>
const wrap = (ui: unknown) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui as never}</MantineProvider>
  </QueryClientProvider>
)
const kid: Kid = { id: 3, full_name: 'Mia', username: 'mia', avatar: null, has_pin: false, age_group: 'kid' }
const daysBack = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
let phones: unknown[]
beforeEach(() => {
  apiMock.mockReset()
  jest.mocked(notifications.show).mockReset()
  window.matchMedia ??= ((() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never)
  phones = [
    { id: 7, label: 'iPhone', created_at: daysBack(10), last_seen_at: new Date().toISOString() },
    { id: 8, label: 'Pixel', created_at: daysBack(10), last_seen_at: daysBack(3) },
  ]
  apiMock.mockImplementation(async (p, i) => {
    if (p === '/kids/3/phones') return phones
    if (p === '/kids/3/phones/7' && i?.method === 'DELETE') {
      phones = phones.slice(1)
      return undefined
    }
    if (p === '/kids/3/enroll') return { url: 'http://box/e', qr_svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', expires_at: '2030-01-01T00:00:00Z' }
    return {}
  })
})

describe('KidPhonesPanel', () => {
  test('rows show label and times', async () => {
    render(wrap(<KidPhonesPanel kid={kid} />))
    expect(await screen.findByText('iPhone')).toBeInTheDocument()
    expect(screen.getByText(/^Added .+ · last used today$/)).toBeInTheDocument()
    expect(screen.getByText(/last used 3 days ago/)).toBeInTheDocument()
  })

  test('empty state', async () => {
    phones = []
    render(wrap(<KidPhonesPanel kid={kid} />))
    expect(await screen.findByText(/No phones yet\. Not every kid has one/)).toBeInTheDocument()
  })

  test('Remove confirms, deletes, refetches and toasts', async () => {
    render(wrap(<KidPhonesPanel kid={kid} />))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove iPhone' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText("Remove Mia's iPhone?")).toBeInTheDocument()
    expect(within(dlg).getByText("It signs out right away. Scan a new code to add it back. Mia's other phones will be asked to reconnect alerts.")).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/kids/3/phones/7', { method: 'DELETE' }))
    await waitFor(() => expect(screen.queryByText('iPhone')).not.toBeInTheDocument())
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Phone removed' }))
  })

  test('a single phone: no mention of other phones', async () => {
    phones = phones.slice(0, 1)
    render(wrap(<KidPhonesPanel kid={kid} />))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove iPhone' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('It signs out right away. Scan a new code to add it back.')).toBeInTheDocument()
  })

  test('QR closes with a toast when the phone signs in', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    try {
      render(wrap(<KidPhonesPanel kid={kid} />))
      await userEvent.click(await screen.findByRole('button', { name: /Add a phone/ }))
      await screen.findByAltText('Sign-in code for Mia')
      phones = [{ id: 9, label: 'Galaxy', created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }, ...phones]
      await act(async () => { jest.advanceTimersByTime(5100) })
      await waitFor(() => expect(screen.queryByAltText('Sign-in code for Mia')).not.toBeInTheDocument())
      expect(await screen.findByText('Galaxy')).toBeInTheDocument()
      expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Phone added' }))
    } finally {
      jest.useRealTimers()
    }
  })

  test('Add a phone shows the QR', async () => {
    render(wrap(<KidPhonesPanel kid={kid} />))
    await userEvent.click(await screen.findByRole('button', { name: /Add a phone/ }))
    expect(await screen.findByAltText('Sign-in code for Mia')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/kids/3/enroll', { method: 'POST' })
  })
})
