import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DevicesSection } from '@/v2/manage/DevicesSection'
import { ListDetail } from '@/v2/parent/ListDetail'
import type { Device, Kid } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn().mockResolvedValue({}) }))

const kids: Kid[] = [{ id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: true }]
const dev = (id: number, name: string): Device => ({ id, name, mac: `aa:bb:cc:dd:ee:0${id}`, vendor: null, status: 'assigned', owner_ids: [7], group_ids: [], online: false, override: null, last_seen: null, resisting: false } as Device)
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}><MantineProvider env="test">{ui}</MantineProvider></QueryClientProvider>
)
let small = false
beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: small && q.includes('767'), media: q, addEventListener() {}, removeEventListener() {} })) as never
})
beforeEach(() => { small = false })

test('picking another device drops the previous device\'s open row', async () => {
  fakeRouter.reset('/devices', { item: '1', open: 'activity', net: 'x' })
  render(wrap(<DevicesSection devices={[dev(1, 'Tablet'), dev(2, 'Console')]} kids={kids} focus={1} />))
  await userEvent.click(await screen.findByText('Console'))
  await waitFor(() => expect(fakeRouter.push).toHaveBeenCalled())
  expect(fakeRouter.push.mock.calls[0][0]).toEqual({ pathname: '/devices', query: { item: 2 } })
})

test('the phone back link leaves the open row behind', () => {
  small = true
  fakeRouter.reset('/devices', { item: '1', open: 'details' })
  render(wrap(<ListDetail list={<p>list</p>} detail={<p>detail</p>} listTitle="Devices" />))
  expect(screen.getByRole('link', { name: /Devices/ }).getAttribute('href')).toBe('/devices')
})
