import { describe, expect, test } from '@jest/globals'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { InstallHint } from '@/v2/components/InstallHint'
import { installPlatform } from '@/v2/components/installPlatform'
import * as pwa from '@/v2/pwa'

const base = { touch: false, standalone: false, secure: true, hasPrompt: false }
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile'

describe('installPlatform', () => {
  test.each([
    ['iPhone Safari', { ...base, ua: IPHONE, touch: true }, 'ios'],
    ['iPad (Macintosh + touch)', { ...base, ua: MAC, touch: true }, 'ios'],
    ['Android Chrome with prompt', { ...base, ua: ANDROID, hasPrompt: true }, 'prompt'],
    ['Android Firefox, no prompt', { ...base, ua: ANDROID }, 'android'],
    ['desktop Firefox', { ...base, ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Firefox/120.0' }, 'other'],
    ['standalone', { ...base, ua: IPHONE, standalone: true }, 'installed'],
    ['insecure', { ...base, ua: IPHONE, secure: false }, 'insecure'],
  ])('%s', (_n, env, want) => expect(installPlatform(env)).toBe(want))
})

const show = (who: 'kid' | 'parent') =>
  render(
    <MantineProvider>
      <InstallHint who={who} />
    </MantineProvider>,
  )

function env(ua: string, secure = true) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true })
  window.matchMedia = (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never
}

describe('InstallHint', () => {
  test('insecure: kid hint hidden', () => {
    env(IPHONE, false)
    const { container } = show('kid')
    expect(container.querySelector('section')).toBeNull()
    expect(container).not.toHaveTextContent('home screen')
  })

  test('insecure: parent sees why', () => {
    env(IPHONE, false)
    show('parent')
    expect(screen.getByText(/once your box has its secure address/)).toBeInTheDocument()
  })

  test('ios shows the three steps', () => {
    env(IPHONE)
    show('kid')
    expect(screen.getByText('Put t@sk4ce on your home screen')).toBeInTheDocument()
    expect(screen.getByText('Add to Home Screen')).toBeInTheDocument()
  })

  test('the prompt button calls prompt()', async () => {
    env(ANDROID)
    const prompt = jest.fn(async () => {})
    pwa.listenInstallPrompt()
    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt }))
    })
    show('kid')
    await userEvent.click(screen.getByRole('button', { name: 'Add to home screen' }))
    expect(prompt).toHaveBeenCalled()
  })
})
