import { expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { StepFinish } from '@/v2/setup/StepFinish'

jest.mock('@/v2/components/InstallHint', () => ({ InstallHint: () => null }))
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }))

test('finish screen says the fun features are on and introduce themselves', () => {
  render(
    <MantineProvider>
      <StepFinish chores={0} kids={0} lock={false} />
    </MantineProvider>,
  )
  expect(screen.getByText('Celebrations, happy hour and streak freezes are on. Each one introduces itself on Today.')).toBeInTheDocument()
})
