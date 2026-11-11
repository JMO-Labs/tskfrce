/** Hungry Cat: pure game rules. Positions are 0..1 of the field. */
export const CAT_MS = 60_000
const FOOD = ['🐟', '🍗', '🧀']
const CATCH_Y = 0.9
const CATCH_W = 0.12
const BIG_W = 0.16
const MAGNET_R = 0.25

export interface CatItem { id: number; x: number; y: number; kind: 'food' | 'sock'; emoji: string }
export interface CatState {
  t: number
  catX: number
  items: CatItem[]
  score: number
  hearts: number
  over: boolean
  nextId: number
  spawnIn: number
  /** round length, ms */
  dur: number
  catchW: number
  magnet: boolean
  slow: boolean
  /** mirrored second cat (multiply), else null */
  cat2: number | null
  multiply: boolean
}

export interface CatOpts { upgrades?: string[]; powerUp?: string | null }

export const initCat = (_level: number, _rng: () => number, o: CatOpts = {}): CatState => {
  const up = o.upgrades ?? []
  return {
    t: 0, catX: 0.5, items: [], score: 0, hearts: 3, over: false, nextId: 0, spawnIn: 500,
    dur: CAT_MS + (up.includes('extra_time') ? 9000 : 0),
    catchW: up.includes('big_bowl') ? BIG_W : CATCH_W,
    slow: up.includes('slow_start'),
    magnet: o.powerUp === 'magnet',
    multiply: o.powerUp === 'multiply',
    cat2: o.powerUp === 'multiply' ? 0.5 : null,
  }
}

export const stepCat = (s: CatState, dtMs: number, catX: number, level: number, rng: () => number): CatState => {
  if (s.over) return s
  const t = s.t + dtMs
  const speed = (0.35 + level * 0.06 + (t / 60000) * 0.35) * (s.slow && t < s.dur * 0.2 ? 0.75 : 1)
  const cat2 = s.multiply ? 1 - catX : null
  const hit = (x: number) => Math.abs(x - catX) <= s.catchW || (cat2 !== null && Math.abs(x - cat2) <= s.catchW)
  let { score, hearts, nextId, spawnIn } = s
  const items: CatItem[] = []
  for (const it of s.items) {
    const y = it.y + (speed * dtMs) / 1000
    let x = it.x
    if (s.magnet && it.kind === 'food' && Math.abs(x - catX) <= MAGNET_R) x += (catX - x) * Math.min(1, (4 * dtMs) / 1000)
    if (y >= CATCH_Y && hit(x)) {
      if (it.kind === 'food') score++
      else hearts--
    } else if (y < 1.05) items.push({ ...it, x, y })
  }
  spawnIn -= dtMs
  while (spawnIn <= 0) {
    const sock = rng() < 0.2
    const x = 0.05 + rng() * 0.9
    items.push({ id: nextId++, x, y: 0, kind: sock ? 'sock' : 'food', emoji: sock ? '🧦' : FOOD[Math.floor(rng() * FOOD.length)] })
    spawnIn += Math.max(380, 900 - t / 100)
  }
  return { ...s, t, catX, cat2, items, score, hearts, nextId, spawnIn, over: hearts <= 0 || t >= s.dur }
}
