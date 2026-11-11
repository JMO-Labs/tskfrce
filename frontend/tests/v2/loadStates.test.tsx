import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from '@testing-library/user-event'
import { SummaryRow, FocusArea } from '@/v2/parent/SummaryRow'
import { LoadFail, RowsSkeleton } from '@/v2/parent/states'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import { useSaveQueue } from '@/v2/hooks/useSaveQueue'
import { toastFail, toastOk } from '@/v2/notify'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/notify', () => ({ toastOk: jest.fn(), toastFail: jest.fn() }))

function Row({ loading }: { loading?: boolean }) {
  const focus = useFocusParam('open')
  return (
    <FocusArea focus={focus}>
      <SummaryRow id="a" icon={<i />} title="Devices" summary="3 online" loading={loading} focus={focus}>
        <p>body</p>
      </SummaryRow>
    </FocusArea>
  )
}

beforeEach(() => {
  fakeRouter.reset('/x')
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as never
  Element.prototype.scrollIntoView = jest.fn()
  jest.clearAllMocks()
})

describe('SummaryRow loading', () => {
  test('shows a quiet bar instead of the summary, and says it is busy', () => {
    const { container } = render(<Row loading />)
    expect(screen.queryByText('3 online')).toBeNull()
    expect(container.querySelector('.p-srow-val .p-srow-sk')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Devices/ })).toHaveAttribute('aria-busy', 'true')
  })

  test('the summary replaces the bar once loaded, in the same slot', () => {
    const { container, rerender } = render(<Row loading />)
    rerender(<Row />)
    expect(screen.getByText('3 online')).toBeInTheDocument()
    expect(container.querySelector('.p-srow-sk')).toBeNull()
    expect(screen.getByRole('button', { name: /Devices/ })).not.toHaveAttribute('aria-busy')
  })
})

test('RowsSkeleton renders the asked number of placeholder rows as one status', () => {
  const { container } = render(<RowsSkeleton rows={3} />)
  expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  expect(container.querySelectorAll('.p-srow')).toHaveLength(3)
})

describe('LoadFail', () => {
  test('says what happened in plain words and retries on demand', async () => {
    const retry = jest.fn()
    render(<LoadFail error={new TypeError('Failed to fetch')} onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the home box")
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  test('uses the server message when there is one', () => {
    render(<LoadFail error={new Error('Not allowed')} onRetry={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Not allowed')
  })
})

describe('useSaveQueue', () => {
  test('a failed save toasts once, resolves false, and the next save still runs', async () => {
    const { result } = renderHook(() => useSaveQueue())
    const bad = new Error('Name is taken')
    await expect(result.current(() => Promise.reject(bad))).resolves.toBe(false)
    expect(toastFail).toHaveBeenCalledWith(bad, undefined)
    await expect(result.current(() => Promise.resolve())).resolves.toBe(true)
    expect(toastOk).toHaveBeenCalledWith('Saved')
  })

  test('a save that never reached the box keeps its value: the toast Retry sends it again', async () => {
    const { result } = renderHook(() => useSaveQueue())
    const send = jest.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(undefined)
    await expect(result.current(send)).resolves.toBe(false)
    const retry = (toastFail as jest.Mock).mock.calls[0][1] as () => void
    expect(typeof retry).toBe('function')
    await act(async () => { retry() })
    expect(send).toHaveBeenCalledTimes(2)
    expect(toastOk).toHaveBeenCalledWith('Saved')
  })

  test('saves run in call order', async () => {
    const { result } = renderHook(() => useSaveQueue())
    const order: number[] = []
    const slow = () => new Promise<void>((r) => setTimeout(() => (order.push(1), r()), 20))
    await Promise.all([result.current(slow), result.current(async () => { order.push(2) })])
    expect(order).toEqual([1, 2])
  })
})
