import { afterEach, describe, expect, test } from '@jest/globals'
import { captureClaim, CLAIM_KEY, groupClaim, readClaim, settleClaim } from '@/v2/setup/claim'

afterEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('claim', () => {
  test('captures #claim=, stores it and strips the fragment', () => {
    window.history.replaceState(null, '', '/setup?a=1#claim=k7m2qxa9pb')
    const spy = jest.spyOn(history, 'replaceState')
    expect(captureClaim()).toBeNull()
    expect(sessionStorage.getItem(CLAIM_KEY)).toBe('K7M2QXA9PB')
    expect(spy).toHaveBeenCalledWith(null, '', '/setup?a=1')
    expect(window.location.hash).toBe('')
    spy.mockRestore()
  })
  test('no hash stores nothing', () => {
    captureClaim()
    expect(readClaim()).toBeNull()
  })
  test('groupClaim', () => {
    expect(groupClaim('k7m2qxa9pb')).toBe('K7M2Q-XA9PB')
    expect(groupClaim('k7m2q xa9pb!!zz')).toBe('K7M2Q-XA9PB')
    expect(groupClaim('oil')).toBe('011')
  })
  test('settleClaim clears only when setup is done', () => {
    sessionStorage.setItem(CLAIM_KEY, 'X')
    settleClaim({ needed: true })
    expect(readClaim()).toBe('X')
    settleClaim({ needed: false })
    expect(readClaim()).toBeNull()
  })
})
