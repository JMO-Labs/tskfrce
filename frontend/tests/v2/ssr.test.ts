/** @jest-environment node */
import { describe, expect, test } from '@jest/globals'
import { captureClaim } from '@/v2/setup/claim'

describe('server render', () => {
  test('captureClaim without window returns null and does not throw', () => {
    expect(typeof window).toBe('undefined')
    expect(captureClaim()).toBeNull()
  })
})
