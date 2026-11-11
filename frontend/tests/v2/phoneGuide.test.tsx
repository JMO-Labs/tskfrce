import { fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { PhoneGuide } from '@/v2/manage/PhoneGuide'
import { guideSeen, markGuideSeen, stepsDone, toggleStep } from '@/v2/manage/phoneGuideStore'

beforeEach(() => localStorage.clear())

describe('phoneGuideStore', () => {
  test('seen flag and step checks are stored per device', () => {
    expect(guideSeen(1)).toBe(false)
    markGuideSeen(1)
    expect(guideSeen(1)).toBe(true)
    expect(guideSeen(2)).toBe(false)
    toggleStep(1, 'android-data')
    expect(stepsDone(1)).toEqual(['android-data'])
    expect(stepsDone(2)).toEqual([])
    toggleStep(1, 'android-data')
    expect(stepsDone(1)).toEqual([])
  })
})

describe('PhoneGuide', () => {
  const show = (onClose = jest.fn()) =>
    render(<MantineProvider><PhoneGuide deviceId={7} opened onClose={onClose} /></MantineProvider>)

  test('lists Android and iPhone steps with a done checkbox each', () => {
    show()
    expect(screen.getAllByText(/Family Link/)[0]).toBeInTheDocument()
    expect(screen.getByText(/Use device MAC/)).toBeInTheDocument()
    expect(screen.getAllByText(/Screen Time/)[0]).toBeInTheDocument()
    expect(screen.getByText(/Private Wi-Fi Address/)).toBeInTheDocument()
    expect(screen.getByText(/Switch to mobile data/)).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    expect(screen.queryByText('Done')).toBeNull() // no fixed "Done" that reads as done when unticked
  })

  test('links to the guide section, not the guide root', () => {
    show()
    expect(screen.getByRole('link', { name: /blocked phone still gets online/ }).getAttribute('href'))
      .toMatch(/\/guide\/06-troubleshooting\.html.*#if-a-blocked-phone-still-gets-online$/)
  })

  test('ticking a step persists; closing marks the guide seen', () => {
    const onClose = jest.fn()
    show(onClose)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(stepsDone(7)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /close|dismiss|later/i }))
    expect(guideSeen(7)).toBe(true)
    expect(onClose).toHaveBeenCalled()
  })
})
