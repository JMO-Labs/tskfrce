/** Mascots, props, seasonal and legendary sets. Static: unlocks follow the kid's level (spec Settled 9). */

const noto = (cp: string) => `/celebrate/noto/${cp}.webp`

export interface Mascot {
  id: string
  name: string
  src: string
  /** level that unlocks it */
  level: number
  /** a prop shown beside it (the panda's taco) */
  prop?: string
  /** owner art is a cut-out with a flat bottom edge; Noto art is a square emoji */
  art: 'cutout' | 'emoji'
  /** seasonal-only mascots never show outside their season */
  season?: string
}

export const PROPS = {
  taco: noto('1f32e'),
  iceCream: noto('1f366'),
  skateboard: noto('1f6f9'),
  popper: noto('1f389'),
  starStruck: noto('1f929'),
  fire: noto('1f525'),
  trophy: noto('1f3c6'),
  balloon: noto('1f388'),
  partyFace: noto('1f973'),
} as const

export const MASCOTS: Mascot[] = [
  { id: 'trex', name: 'T-Rex', src: '/celebrate/mascots/trex.svg', level: 1, art: 'cutout' },
  { id: 'dog', name: 'Dog', src: noto('1f415'), level: 1, art: 'emoji' },
  { id: 'cat', name: 'Cat', src: noto('1f431'), level: 1, art: 'emoji' },
  { id: 'panda', name: 'Panda', src: noto('1f43c'), level: 2, art: 'emoji', prop: PROPS.taco },
  { id: 'raccoon', name: 'Raccoon', src: noto('1f99d'), level: 3, art: 'emoji' },
  { id: 'croc', name: 'Alligator', src: noto('1f40a'), level: 4, art: 'emoji', prop: PROPS.skateboard },
  { id: 'monkey', name: 'Monkey', src: noto('1f412'), level: 5, art: 'emoji' },
  { id: 'dino', name: 'Dino', src: noto('1f996'), level: 6, art: 'emoji', prop: PROPS.iceCream },
  { id: 'unicorn', name: 'Unicorn', src: noto('1f984'), level: 8, art: 'emoji' },
  { id: 'snowman', name: 'Snowman', src: noto('26c4'), level: 1, art: 'emoji', season: 'december' },
]

export const mascotById = (id: string) => MASCOTS.find((m) => m.id === id) ?? MASCOTS[0]

/** Seasonal sets: a date range (month-day, inclusive) that adds mascots and words. Ships with December. */
export interface Season {
  id: string
  from: string // 'MM-DD'
  to: string
  mascots: string[]
  words: string[]
}
export const SEASONS: Season[] = [{ id: 'december', from: '12-01', to: '12-31', mascots: ['snowman'], words: ['SNOW-TASTIC!'] }]

const md = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const activeSeason = (d: Date) => SEASONS.find((s) => md(d) >= s.from && md(d) <= s.to) ?? null

/** Mascot ids this kid can see now: unlocked by level, plus the season's. */
export function mascotsFor(level: number, d: Date) {
  const season = activeSeason(d)
  return MASCOTS.filter((m) => (m.season ? m.season === season?.id : m.level <= level)).map((m) => m.id)
}

/** Legendary shows (about 1 in 25): a parade across the screen, or a dance party. */
export const LEGENDARY = {
  parade: { word: 'LEGENDARY!', cast: ['unicorn', 'dino', 'panda', 'croc', 'dog', 'cat'] },
  party: { word: 'DANCE PARTY!', cast: ['monkey', 'raccoon', 'trex', 'cat', 'dog'] },
} as const
