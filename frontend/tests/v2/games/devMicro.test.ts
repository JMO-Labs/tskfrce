import { expect, test } from '@jest/globals'
import { devGame, devMicro } from '@/v2/games/devMicro'

test('devMicro picks a known microgame from the query outside production', () => {
  expect(devMicro('?micro=flip', 'development')).toBe('flip')
  expect(devMicro('?micro=nope', 'development')).toBeNull()
  expect(devMicro('', 'development')).toBeNull()
  expect(devMicro('?micro=flip', 'production')).toBeNull()
})

test('devGame picks a thinking game outside production', () => {
  expect(devGame('?game=math-dash', 'development')).toBe('math-dash')
  expect(devGame('?game=hungry-cat', 'development')).toBe('hungry-cat')
  expect(devGame('?game=quickfire', 'development')).toBeNull()
  expect(devGame('?game=nope', 'development')).toBeNull()
  expect(devGame('?game=math-dash', 'production')).toBeNull()
})
