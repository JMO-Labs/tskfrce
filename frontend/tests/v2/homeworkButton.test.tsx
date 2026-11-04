import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from '@jest/globals'
import { MantineProvider } from '@mantine/core'
import { HomeworkButton } from '@/v2/manage/HomeworkButton'

const renderWithProviders = (component: React.ReactElement) => {
  return render(<MantineProvider>{component}</MantineProvider>)
}

describe('HomeworkButton', () => {
  test('button hidden when the device is online', () => {
    renderWithProviders(
      <HomeworkButton target={{ kind: 'device', id: 1 }} disabled={true} onStart={jest.fn()} />,
    )
    const button = screen.getByRole('button', { name: /Homework mode/i })
    expect(button).toBeDisabled()
  })

  test('picking 90 calls onStart(90)', async () => {
    const user = userEvent.setup()
    const onStart = jest.fn()
    renderWithProviders(<HomeworkButton target={{ kind: 'device', id: 1 }} onStart={onStart} />)

    const button = screen.getByRole('button', { name: /Homework mode/i })
    await user.click(button)

    const option = screen.getByRole('menuitem', { name: '90 min' })
    await user.click(option)

    expect(onStart).toHaveBeenCalledWith(90)
  })

  test('default 60', async () => {
    const user = userEvent.setup()
    const onStart = jest.fn()
    renderWithProviders(<HomeworkButton target={{ kind: 'device', id: 1 }} onStart={onStart} />)

    const button = screen.getByRole('button', { name: /Homework mode/i })
    await user.click(button)

    const option = screen.getByRole('menuitem', { name: '60 min' })
    await user.click(option)

    expect(onStart).toHaveBeenCalledWith(60)
  })
})
