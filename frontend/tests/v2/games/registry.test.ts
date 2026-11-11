import { expect, test } from '@jest/globals'
import { MICROS } from '@/v2/games/quick'

const KEYS = 'sock-snatch plate-tower bubble-pop quick-draw sweep-swipe flip plug zip squeeze dodge water hang shh catch match fold feed spot count cat-dash'.split(' ')

test('MICROS lists the 20 microgames in spec order, matching the server keys', () => {
  expect(MICROS.map((m) => m.key)).toEqual(KEYS)
  MICROS.forEach((m) => expect(m.cmd).toMatch(/^[A-Z]+!$/))
})
