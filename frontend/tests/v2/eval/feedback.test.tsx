import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { api, ApiError } from '@/v2/api'
import { track } from '@/v2/eval/track'
import { useEvalStatus } from '@/v2/eval/useEvalStatus'
import { noteError } from '@/v2/eval/errors'
import { closeFeedback, openFeedback } from '@/v2/eval/feedbackStore'
import { FeedbackDrawer } from '@/v2/eval/FeedbackDrawer'
import { FeedbackMoreLink, FeedbackRailButton } from '@/v2/eval/FeedbackEntry'

jest.mock('html-to-image', () => ({ toJpeg: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/eval/track')
jest.mock('@/v2/eval/useEvalStatus')
jest.mock('@/v2/api', () => ({ ...jest.requireActual('@/v2/api'), api: jest.fn() }))
jest.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/kids', events: { on: jest.fn(), off: jest.fn() } }),
}))

const apiMock = api as jest.Mock
const status = useEvalStatus as jest.Mock
const on = { loading: false, data: { stats: true, feedback: true, household: 'abc' } }
const ui = (n: React.ReactNode) => <MantineProvider>{n}</MantineProvider>

beforeAll(() => {
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})

beforeEach(() => {
  let n = 0
  URL.createObjectURL = jest.fn(() => `blob:t/${++n}`)
  URL.revokeObjectURL = jest.fn()
  status.mockReturnValue(on)
  apiMock.mockReset().mockResolvedValue({ ok: true })
  act(() => closeFeedback())
})

const file = (size: number, name = 'a.png') => new File([new Uint8Array(size)], name, { type: 'image/png' })

async function openDrawer() {
  render(ui(<FeedbackDrawer />))
  act(() => openFeedback())
  return screen.findByRole('dialog', { name: 'Send feedback' })
}

test('a closed drawer leaves no dialog behind for Esc handlers to see', async () => {
  await openDrawer()
  act(() => closeFeedback())
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})

test('send with empty text shows the note error and sends nothing', async () => {
  await openDrawer()
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(screen.getByText('Write a short note first.')).toBeInTheDocument()
  expect(apiMock).not.toHaveBeenCalled()
})

test('bug with 4 stars sends type, stars, route and recent errors', async () => {
  noteError(new ApiError(500, 'x'))
  await openDrawer()
  await userEvent.click(screen.getByRole('button', { name: 'Bug' }))
  act(() => screen.getByRole('radio', { name: '4' }).focus())
  await userEvent.keyboard(' ')
  await userEvent.type(screen.getByLabelText("What's on your mind?"), 'Lock is late')
  expect(screen.getByText('12 / 2,000')).toBeInTheDocument()
  await userEvent.upload(screen.getByLabelText('Add a picture'), file(10))
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(apiMock).toHaveBeenCalled())
  const [path, init] = apiMock.mock.calls[0]
  expect(path).toBe('/eval/feedback')
  expect(init.method).toBe('POST')
  const form = init.body as FormData
  expect(form.get('type')).toBe('bug')
  expect(form.get('stars')).toBe('4')
  expect(form.get('text')).toBe('Lock is late')
  expect(form.get('route')).toBe('/kids')
  expect(form.get('errors')).toBe('http_500')
  expect((form.getAll('shots')[0] as File).name).toBe('shot-1.jpg')
})

test('a picture over 3 MB shows the too-big line', async () => {
  await openDrawer()
  await userEvent.upload(screen.getByLabelText('Add a picture'), file(4 * 1024 * 1024))
  expect(screen.getByText('That picture is too big. Pick one under 3 MB.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove screenshot 1' })).toBeNull()
})

test('three shots disable both add buttons; removing one drops it', async () => {
  await openDrawer()
  expect(screen.getByText("Screenshots may show names. Remove any you don't want to send.")).toBeInTheDocument()
  for (let i = 0; i < 3; i++) await userEvent.upload(screen.getByLabelText('Add a picture'), file(10))
  expect(screen.getByRole('button', { name: 'Capture this screen' })).toBeDisabled()
  expect(screen.getByLabelText('Add a picture')).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Remove screenshot 2' }))
  expect(screen.queryByRole('button', { name: 'Remove screenshot 3' })).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:t/2')
  expect(screen.getByRole('button', { name: 'Capture this screen' })).toBeEnabled()
})

test('entry points render nothing when feedback is off, and open the drawer when on', async () => {
  status.mockReturnValue({ loading: false, data: { stats: true, feedback: false, household: null } })
  const { rerender } = render(ui(<><FeedbackRailButton /><FeedbackMoreLink /></>))
  expect(screen.queryByRole('button')).toBeNull()
  status.mockReturnValue(on)
  rerender(ui(<><FeedbackRailButton /><FeedbackMoreLink /><FeedbackDrawer /></>))
  await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  expect(await screen.findByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument()
  expect(screen.getByText('Ideas, bugs and screenshots')).toBeInTheDocument()
})

test('a failed capture reopens the drawer and offers a picture instead', async () => {
  const { toJpeg } = jest.requireMock('html-to-image') as { toJpeg: jest.Mock }
  toJpeg.mockRejectedValueOnce(new Error('canvas'))
  await openDrawer()
  await userEvent.click(screen.getByRole('button', { name: 'Capture this screen' }))
  expect(await screen.findByText("Couldn't capture the screen. Add a picture instead.", {}, { timeout: 2000 })).toBeInTheDocument()
  expect(await screen.findByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument()
})

test('a capture adds a thumbnail and keeps the typed note through the close and reopen', async () => {
  jest.useFakeTimers()
  try {
    const { toJpeg } = jest.requireMock('html-to-image') as { toJpeg: jest.Mock }
    toJpeg.mockResolvedValueOnce('data:image/jpeg;base64,AAAA')
    global.fetch = jest.fn(async () => ({ blob: async () => new Blob(['jpg'], { type: 'image/jpeg' }) })) as never
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    await openDrawer()
    await user.type(screen.getByLabelText("What's on your mind?"), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Capture this screen' }))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000)
    })
    expect(toJpeg).toHaveBeenCalledWith(document.body, { quality: 0.7, pixelRatio: 1 })
    expect(await screen.findByRole('button', { name: 'Remove screenshot 1' })).toBeInTheDocument()
    expect(screen.getByLabelText("What's on your mind?")).toHaveValue('Hello')
    expect(await screen.findByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument()
  } finally {
    jest.useRealTimers()
  }
})

test('cancel with a draft counts as an abandoned form and clears it', async () => {
  await openDrawer()
  await userEvent.type(screen.getByLabelText("What's on your mind?"), 'Half a thought')
  ;(track as jest.Mock).mockClear()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(track).toHaveBeenCalledWith('form_abandoned', { form: 'feedback' })
  expect(screen.getByLabelText("What's on your mind?", { selector: 'textarea' })).toHaveValue('')
})
