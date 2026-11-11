import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { FamilyCard } from '@/v2/manage/FamilyCards'
import { SettingsRow } from '@/v2/manage/KidRows'
import type { Family, Kid } from '@/v2/types'

;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
jest.mock('next/router', () => ({ useRouter: () => require('../helpers/fakeRouter').useFakeRouter() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>

const catalog = { style: 'strict', kids: [], plans: {}, family: {} }
const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MantineProvider>{ui}</MantineProvider></QueryClientProvider>)
const focus = { param: 'open', open: 'settings', isOpen: (id: string) => id === 'settings', openTo: () => {}, toggle: () => {}, close: () => {} }

beforeEach(() => apiMock.mockReset().mockImplementation(async (p) => (p === '/presets' ? catalog : p === '/today' ? { kids: [] } : {})))

describe('style in Settings', () => {
  test('family card shows a Style row with the saved style', async () => {
    wrap(<FamilyCard fam={{ name: 'S', timezone: 'UTC', reset_time: '06:00', early_bonus_cap: 5, screen_time_price: 20 } as unknown as Family} />)
    expect(await screen.findByRole('button', { name: /^Style/ })).toBeInTheDocument()
    expect(await screen.findByText('Strict')).toBeInTheDocument()
  })

  test('kid settings: Style section and lock switch PATCHes chores_lock', async () => {
    const kid = { id: 5, full_name: 'Ivy', username: 'ivy', avatar: null, has_pin: false, age_group: 'kid', chores_lock: true } as unknown as Kid
    wrap(<SettingsRow kid={kid} focus={focus} editing={false} focusPin={false} onSaved={() => {}} onCancel={() => {}} onDirty={() => {}} />)
    expect(await screen.findByText('Style')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Internet locks until chores are done'))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/kids/5', { method: 'PATCH', body: { chores_lock: false } }))
  })
})
