import { describe, expect, test } from '@jest/globals'
import { LAST, savedStep } from '@/v2/setup/setupStep'

describe('savedStep', () => {
  test('finished is null, last step is kept', () => {
    expect(LAST).toBe(7)
    expect(savedStep(8)).toBeNull()
    expect(savedStep(7)).toBe(7)
  })
})
