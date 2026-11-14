import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { FingerbankHint, weakName } from '@/v2/manage/FingerbankHint'
import type { Device } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const mockApi = api as unknown as Mock<(path: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>

const dev = (name_source: Device['name_source']) => ({ id: 1, name: 'Apple', name_source }) as Device
const show = (fam: object, d: Device) => {
  mockApi.mockImplementation((path, o) => Promise.resolve(o?.method === 'PATCH' ? { ...fam, ...(o.body as object) } : fam))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider><FingerbankHint device={d} /></MantineProvider>
    </QueryClientProvider>,
  )
}

describe('FingerbankHint', () => {
  beforeEach(() => mockApi.mockReset())

  test('weakName: only vendor or unknown fallbacks', () => {
    expect(['vendor', 'unknown', 'mdns', 'fingerprint'].map((s) => weakName(dev(s as Device['name_source'])))).toEqual([true, true, false, false])
  })

  test('shows once for a vendor-named device, then dismisses for good', async () => {
    show({ fingerbank_enabled: false, fingerbank_hint_seen: false }, dev('vendor'))
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(mockApi).toHaveBeenCalledWith('/family', { method: 'PATCH', body: { fingerbank_hint_seen: true } })
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull())
  })

  test.each([
    ['already on', { fingerbank_enabled: true, fingerbank_hint_seen: false }, 'vendor'],
    ['already seen', { fingerbank_enabled: false, fingerbank_hint_seen: true }, 'unknown'],
    ['good name', { fingerbank_enabled: false, fingerbank_hint_seen: false }, 'mdns'],
  ])('hidden when %s', async (_n, fam, src) => {
    show(fam, dev(src as Device['name_source']))
    await waitFor(() => expect(mockApi).toHaveBeenCalled())
    expect(screen.queryByRole('note')).toBeNull()
  })
})
