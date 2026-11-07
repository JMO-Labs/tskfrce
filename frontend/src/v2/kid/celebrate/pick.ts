import { LEGENDARY, legendaryCast, mascotById } from './catalog'
import { SAYS, WORDS } from './words'

export type Rng = () => number
export type CardFx = 'pop' | 'wiggle' | 'stamp' | 'blast' | 'explode'
export type BurstFx = 'confetti' | 'coins' | 'balloon' | 'disco' | 'sneeze' | 'fireworks'
/** mascot looks (mascot-styles-v2) and entrances (mascots-animated-v1) */
export type StyleFx = 'original' | 'sticker' | 'comic' | 'popart' | 'neon' | 'retro' | 'mono' | 'jelly'
export type EntryFx = 'rise' | 'side' | 'drop' | 'spin' | 'zoom' | 'peek'
/** a firework: x and y in % of the content column, delay in s */
export type Spark = [number, number, number]
export type LegendaryFx = keyof typeof LEGENDARY
export type WordColor = 'coral' | 'green' | 'sun' | 'lav'

export const CARDS: CardFx[] = ['pop', 'wiggle', 'stamp', 'blast', 'explode']
export const BURSTS: BurstFx[] = ['confetti', 'coins', 'balloon', 'disco', 'sneeze', 'fireworks']
export const STYLES: StyleFx[] = ['original', 'sticker', 'comic', 'popart', 'neon', 'retro', 'mono', 'jelly']
export const ENTRIES: EntryFx[] = ['rise', 'side', 'drop', 'spin', 'zoom', 'peek']
/** the original look comes up most often; the others share the rest */
export const ORIGINAL_ODDS = 0.4
const COLORS: WordColor[] = ['coral', 'green', 'sun', 'lav']
export const LEGENDARY_ODDS = 1 / 25

export interface Combo {
  card: CardFx
  burst: BurstFx
  /** the big word on screen (some effects bring their own) */
  word: string
  color: WordColor
  mascot: string | null
  /** what the mascot's bubble says */
  say: string
  legendary: LegendaryFx | null
  /** legendary only: who dances or marches (unlocked mascots) */
  cast: string[]
  /** the mascot's look and entrance */
  style: StyleFx
  entry: EntryFx
  /** fireworks only: where and when each one pops */
  sparks: Spark[]
}

export interface PickOpts {
  mascots: string[]
  /** extra words (seasonal) */
  words?: string[]
  /** a mascot is likely (half the time) */
  wantMascot: boolean
  /** a mascot always (big moments, Little) */
  forceMascot?: boolean
  /** card effects allowed (Little keeps its tile on screen) */
  cards?: CardFx[]
}

// Effects that carry their own word (from the mockups).
const BURST_WORD: Partial<Record<BurstFx, string>> = { balloon: 'POP!', disco: 'GROOVY!', sneeze: 'ACHOO!' }
const CARD_WORD: Partial<Record<CardFx, string>> = { blast: 'WHOOSH!' }

const of = <T,>(rng: Rng, xs: readonly T[]) => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))]

export const comboKey = (c: Combo) => [c.legendary, c.card, c.burst, c.word, c.mascot, c.style, c.entry].join('|')

/** Weighted look: original about 40%, each of the other seven about 8.6%. */
export function pickStyle(rng: Rng): StyleFx {
  const r = rng()
  if (r < ORIGINAL_ODDS) return 'original'
  const rest = STYLES.slice(1)
  return rest[Math.min(rest.length - 1, Math.floor(((r - ORIGINAL_ODDS) / (1 - ORIGINAL_ODDS)) * rest.length))]
}

const sparks = (rng: Rng): Spark[] =>
  Array.from({ length: 3 + Math.floor(rng() * 3) }, () => [Math.round(12 + rng() * 76), Math.round(10 + rng() * 45), Math.round(rng() * 6) / 10])

function draw(rng: Rng, o: PickOpts): Combo {
  const legend = rng() < LEGENDARY_ODDS
  const color = of(rng, COLORS)
  if (legend) {
    const legendary = of(rng, Object.keys(LEGENDARY) as LegendaryFx[])
    const mascot = o.forceMascot && o.mascots.length ? of(rng, o.mascots) : null
    // no mascot: look and entrance don't show, so they stay fixed (same guard as below)
    const look = { style: mascot ? pickStyle(rng) : 'original', entry: mascot ? of(rng, ENTRIES) : 'rise', sparks: [] }
    return { card: 'pop', burst: 'confetti', word: LEGENDARY[legendary].word, color, mascot, say: 'WOW!', legendary, cast: legendaryCast(legendary, o.mascots), ...look }
  }
  const card = of(rng, o.cards ?? CARDS)
  const burst = of(rng, BURSTS)
  const word = BURST_WORD[burst] ?? CARD_WORD[card] ?? of(rng, [...WORDS, ...(o.words ?? [])])
  const withMascot = o.mascots.length > 0 && (o.forceMascot || (o.wantMascot && rng() < 0.5))
  const mascot = withMascot ? of(rng, o.mascots) : null
  const own = mascot ? mascotById(mascot).says : undefined
  const say = own && rng() < 0.6 ? own : of(rng, SAYS)
  // no mascot: look and entrance don't show, so they stay fixed (and out of the no-repeat key)
  const style = mascot ? pickStyle(rng) : 'original'
  const entry = mascot ? of(rng, ENTRIES) : 'rise'
  return { card, burst, word, color, mascot: mascot && mascotById(mascot).id, say, legendary: null, cast: [], style, entry, sparks: burst === 'fireworks' ? sparks(rng) : [] }
}

/** A random combination that is never exactly the last one. The first draw decides legendary (about 1 in 25). */
export function pickCombo(rng: Rng, last: Combo | null, o: PickOpts): Combo {
  let c = draw(rng, o)
  for (let i = 0; i < 5 && last && comboKey(c) === comboKey(last); i++) c = draw(rng, o)
  if (last && comboKey(c) === comboKey(last)) {
    // a stuck RNG: step the card effect on, dropping any word the old card brought
    const cards = o.cards ?? CARDS
    const card = cards[(cards.indexOf(c.card) + 1) % cards.length]
    const word = c.legendary || c.word === CARD_WORD[c.card] ? 'WOW!' : c.word
    c = { ...c, legendary: null, cast: [], card, word: BURST_WORD[c.burst] ?? CARD_WORD[card] ?? word }
  }
  return c
}

/** Small seeded RNG (mulberry32) for tests and the dev preview hook. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
