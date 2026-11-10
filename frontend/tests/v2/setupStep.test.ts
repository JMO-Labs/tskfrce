import { describe, expect, test } from '@jest/globals'
import { LAST, savedStep } from '@/v2/setup/setupStep'

describe('savedStep', () => {
  test('finished is null, last step is kept', () => {
    expect(LAST).toBe(8)
    expect(savedStep(9)).toBeNull()
    expect(savedStep(8)).toBe(8)
  })
})
