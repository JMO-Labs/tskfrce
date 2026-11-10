import { expect, test } from '@jest/globals'
import { devMicro } from '@/v2/games/devMicro'

test('devMicro picks a known microgame from the query outside production', () => {
  expect(devMicro('?micro=flip', 'development')).toBe('flip')
  expect(devMicro('?micro=nope', 'development')).toBeNull()
  expect(devMicro('', 'development')).toBeNull()
  expect(devMicro('?micro=flip', 'production')).toBeNull()
})
