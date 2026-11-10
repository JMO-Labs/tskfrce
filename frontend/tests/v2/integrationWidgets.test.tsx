import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { readFileSync } from 'fs'
import { join } from 'path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { IntegrationWidgets, WidgetFrame } from '@/v2/integrations/WidgetFrame'
import { WidgetBlocks } from '@/v2/integrations/WidgetBlocks'
import type { WidgetGroup } from '@/v2/integrations/types'

jest.mock('@/v2/api', () => ({ api: jest.fn(), errorText: (e: Error) => e.message }))
jest.mock('@/v2/notify', () => ({ toastOk: jest.fn(), toastFail: jest.fn() }))
jest.mock('@/v2/today/PhotoViewer', () => ({ useAuthImage: (p: string) => (p ? 'blob:x' : null) }))
const apiMock = api as unknown as Mock<(p: string, i?: unknown) => Promise<unknown>>

const G: WidgetGroup = { install_id: 7, name: 'Demo', icon: 'extension', widgets: [] }
const wrap = (ui: React.ReactNode) =>
  render(<MantineProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider></MantineProvider>)
const readSrc = (f: string) => readFileSync(join(__dirname, '../..', f), 'utf8')

beforeEach(() => apiMock.mockReset())

describe('widgets', () => {
  test('frames every widget with the integration name and icon', () => {
    render(<WidgetFrame group={G}><span /></WidgetFrame>)
    expect(screen.getByText('Demo')).toBeInTheDocument()
    expect(screen.getByText('Integration')).toBeInTheDocument()
  })
  test('external links show their domain and open safely', () => {
    render(<WidgetBlocks block={{ type: 'text', text: 'Open', link: 'https://duo.example.com/x' }} onPress={jest.fn()} />)
    const a = screen.getByRole('link')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    expect(a).toHaveAttribute('target', '_blank')
    expect(within(a).getByText('duo.example.com')).toBeInTheDocument()
  })
  test('ignores unknown block types and never injects HTML', () => {
    const { container } = render(<WidgetBlocks block={{ type: 'html', html: '<img src=x onerror=alert(1)>' } as never} onPress={jest.fn()} />)
    expect(container.innerHTML).toBe('')
  })
  test('text that looks like HTML stays text', () => {
    render(<WidgetBlocks block={{ type: 'text', text: '<b>hi</b>' }} onPress={jest.fn()} />)
    expect(screen.getByText('<b>hi</b>')).toBeInTheDocument()
  })
  test('progress has aria values, image has alt', () => {
    render(<>
      <WidgetBlocks block={{ type: 'progress', label: 'Pages', value: 3, max: 10 }} onPress={jest.fn()} />
      <WidgetBlocks block={{ type: 'image', url: '/integration-widgets/7/image?u=a', alt: 'A cat' }} onPress={jest.fn()} />
    </>)
    expect(screen.getByRole('progressbar', { name: 'Pages' })).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByAltText('A cat')).toHaveAttribute('src', 'blob:x')
  })
  test('button press posts, then refetches widgets', async () => {
    const group: WidgetGroup = { ...G, widgets: [{ id: 'w1', root: { type: 'card', title: 'Hi', children: [{ type: 'button', id: 'go', label: 'Go', action: 'chore.complete' }] } }] }
    apiMock.mockImplementation(async (p: string) => (p.endsWith('/press') ? [{ result: 'applied', reason: null }] : [group]))
    wrap(<IntegrationWidgets surface="parent" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Go' }))
    expect(apiMock).toHaveBeenCalledWith('/integration-widgets/7/press', expect.objectContaining({ method: 'POST', body: { widget_id: 'w1', button_id: 'go' } }))
    await waitFor(() => expect(apiMock.mock.calls.filter((c) => c[0].startsWith('/integration-widgets?')).length).toBe(2))
  })
  test('renders nothing on error or empty', async () => {
    apiMock.mockRejectedValue(new Error('x'))
    const { container } = wrap(<IntegrationWidgets surface="parent" />)
    await waitFor(() => expect(apiMock).toHaveBeenCalled())
    expect(container.querySelector('.iw-frame')).toBeNull()
  })
  test('source never uses dangerouslySetInnerHTML', () => {
    for (const f of ['WidgetBlocks.tsx', 'WidgetFrame.tsx']) expect(readSrc(`src/v2/integrations/${f}`)).not.toMatch(/dangerouslySetInnerHTML/)
  })
})
