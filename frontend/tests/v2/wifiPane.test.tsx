import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WifiPane } from '@/v2/manage/WifiPane'

jest.mock('next/router', () => ({ useRouter: () => ({ query: {} }) }))
jest.mock('@/v2/notify', () => ({
  toastFail: jest.fn(),
  toastOk: jest.fn(),
}))

jest.mock('@/v2/hooks/useWifi', () => ({
  useWifiStatus: jest.fn(() => ({
    data: { is_connected: false, current_ssid: null, signal_strength: null },
    isPending: false,
    isError: false,
  })),
  useWifiScan: jest.fn(() => ({
    data: [{ ssid: 'TestNet', signal: 75, security: 'wpa' }],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  })),
  useWifiJoin: jest.fn(() => ({
    mutate: jest.fn(),
    isPending: false,
  })),
  useWifiForget: jest.fn(() => ({
    mutate: jest.fn(),
  })),
  useWifiCountry: jest.fn(() => ({
    mutate: jest.fn(),
  })),
}))

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  )

describe('WifiPane', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renders title and subtitle', () => {
    wrap(<WifiPane />)
    expect(screen.getByText('Wi-Fi Settings')).toBeInTheDocument()
    expect(screen.getByText(/Manage your box/i)).toBeInTheDocument()
  })

  test('displays current network section', () => {
    wrap(<WifiPane />)
    expect(screen.getByText('Current Network')).toBeInTheDocument()
  })

  test('displays region selector', () => {
    wrap(<WifiPane />)
    expect(screen.getByText('Region')).toBeInTheDocument()
  })

  test('scan button exists and is clickable', () => {
    wrap(<WifiPane />)
    const scanBtn = screen.getByRole('button', { name: /Scan/i })
    expect(scanBtn).toBeInTheDocument()
    fireEvent.click(scanBtn)
    expect(screen.getByText('TestNet')).toBeInTheDocument()
  })

  test('forget button shows confirmation dialog', () => {
    window.confirm = jest.fn(() => false)
    wrap(<WifiPane />)
    const forgetBtn = screen.getByRole('button', { name: /Forget/i })
    fireEvent.click(forgetBtn)
    expect(window.confirm).toHaveBeenCalled()
  })

  test('other network button opens join dialog', () => {
    wrap(<WifiPane />)
    const scanBtn = screen.getByRole('button', { name: /Scan/i })
    fireEvent.click(scanBtn)
    const otherBtn = screen.getByText('Other network...')
    fireEvent.click(otherBtn)
    expect(screen.getByText('Join Network')).toBeInTheDocument()
  })
})
