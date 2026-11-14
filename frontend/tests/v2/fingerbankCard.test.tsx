import { describe, expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FingerbankCard, fingerbankError } from '@/v2/manage/FamilyCards'
import { DeviceNetwork } from '@/v2/manage/DeviceNetwork'
import type { Device, Family } from '@/v2/types'

jest.mock('next/link', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
jest.mock('@/v2/api', () => ({ api: jest.fn().mockResolvedValue({ online: true }) }))

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider env="test">{ui}</MantineProvider>
    </QueryClientProvider>,
  )

describe('Fingerbank last error', () => {
  test('maps codes (cloud_ shares texts, unknown falls back, none is null)', () => {
    expect(fingerbankError('bad_key')).toMatch(/rejected your key/)
    expect(fingerbankError('cloud_offline')).toMatch(/reach Fingerbank/)
    expect(fingerbankError('weird')).toMatch(/failed/)
    expect(fingerbankError(null)).toBeNull()
  })

  test('card shows the error when enabled, nothing when clean', () => {
    const fam = { name: 'Home', fingerbank_enabled: true, fingerbank_key_set: true, fingerbank_cloud: false, fingerbank_last_error: 'bad_key' } as Family
    const { unmount } = wrap(<FingerbankCard fam={fam} />)
    expect(screen.getByRole('alert').textContent).toMatch(/rejected your key/)
    unmount()
    wrap(<FingerbankCard fam={{ ...fam, fingerbank_last_error: null }} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('device card type row', () => {
  const d = (device_class?: string | null) => ({ id: 1, name: 'x', mac: 'aa:bb:cc:dd:ee:ff', vendor: 'Apple', device_class }) as Device
  test('shows the class ahead of maker; hidden when unknown', () => {
    const { unmount } = wrap(<DeviceNetwork device={d('Android device')} />)
    expect(screen.getByText('Type').nextSibling?.textContent).toBe('Android device')
    unmount()
    wrap(<DeviceNetwork device={d(null)} />)
    expect(screen.queryByText('Type')).toBeNull()
  })
})
