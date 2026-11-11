import { MASCOTS } from '../kid/celebrate/catalog'
import type { CelebrateLevel } from '../types'
import { reduceDecor } from './useGames'

const CAST = MASCOTS.filter((m) => m.art === 'cutout' && m.level === 0)

/** One of the owner's mascots, stable for a number (kid id, play id). */
export const mascotSrc = (n: number) => CAST[Math.abs(n) % CAST.length].src

/** 'off' skips decorative motion, 'small' shortens it. */
export const decor = (c: CelebrateLevel): CelebrateLevel => (reduceDecor(c) ? 'off' : c)

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Fluent 3D emoji assets for quick-fire games. */
export const fluentEmoji: Record<string, string> = {
  flip: '/art/fluent/apple.webp',
  hang: '/art/fluent/banana.webp',
  water: '/art/fluent/book.webp',
  catDash: '/art/fluent/cat.webp',
  plateTower: '/art/fluent/cookie.webp',
  spot: '/art/fluent/dog.webp',
  catch: '/art/fluent/eggplant.webp',
  dodge: '/art/fluent/flag.webp',
  count: '/art/fluent/hamster.webp',
  squeeze: '/art/fluent/pear.webp',
  shh: '/art/fluent/pizza.webp',
  match: '/art/fluent/shoe.webp',
}
