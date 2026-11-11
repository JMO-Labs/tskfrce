import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WifiSetup from '@/pages/wifi-setup'

jest.mock('@/v2/hooks/useSetupWifi', () => ({
  useSetupWifiStatus: jest.fn(() => ({
    data: { state: 'idle' },
    isPending: false,
    isError: false,
  })),
  useSetupWifiJoin: jest.fn(() => ({
    mutate: jest.fn(),
    isPending: false,
  })),
  useSetupWifiScan: jest.fn(() => ({
    data: [
      { ssid: 'TestWifi', signal: 80, security: 'wpa' },
      { ssid: 'GuestNet', signal: 60, security: 'wpa' },
    ],
    isPending: false,
  })),
}))

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  )

describe('WifiSetup page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renders heading and description', () => {
    wrap(<WifiSetup />)
    expect(screen.getByText('Connect to Wi-Fi')).toBeInTheDocument()
    expect(screen.getByText(/Select your home network/i)).toBeInTheDocument()
  })

  test('displays available networks list', () => {
    wrap(<WifiSetup />)
    expect(screen.getByText('Available Networks')).toBeInTheDocument()
    expect(screen.getByText('TestWifi')).toBeInTheDocument()
    expect(screen.getByText('GuestNet')).toBeInTheDocument()
  })

  test('clicking network fills ssid field', () => {
    wrap(<WifiSetup />)
    const networkBtn = screen.getByText('TestWifi').closest('button')
    fireEvent.click(networkBtn!)
    const ssidInput = screen.getByDisplayValue('TestWifi') as HTMLInputElement
    expect(ssidInput.value).toBe('TestWifi')
  })

  test('other network button opens modal', () => {
    wrap(<WifiSetup />)
    const otherBtn = screen.getByText('Other network...').closest('button')
    fireEvent.click(otherBtn!)
    expect(screen.getByText('Join Network')).toBeInTheDocument()
  })

  test('form requires network name', () => {
    wrap(<WifiSetup />)
    const ssidInput = screen.getByPlaceholderText('MyHomeWifi') as HTMLInputElement
    expect(ssidInput.required).toBe(true)
  })

  test('displays success message when connected', () => {
    const useSetupWifiStatus = require('@/v2/hooks/useSetupWifi').useSetupWifiStatus
    useSetupWifiStatus.mockReturnValue({
      data: { state: 'connected', ssid: 'MyWifi' },
      isPending: false,
      isError: false,
    })
    wrap(<WifiSetup />)
    expect(screen.getByText(/Connected.*MyWifi/)).toBeInTheDocument()
  })
})
