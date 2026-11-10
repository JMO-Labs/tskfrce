/** Hungry Cat: pure game rules. Positions are 0..1 of the field. */
export const CAT_MS = 60_000
const FOOD = ['🐟', '🍗', '🧀']
const CATCH_Y = 0.9
const CATCH_W = 0.12

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
}

export const initCat = (_level: number, _rng: () => number): CatState => ({
  t: 0, catX: 0.5, items: [], score: 0, hearts: 3, over: false, nextId: 0, spawnIn: 500,
})

export const stepCat = (s: CatState, dtMs: number, catX: number, level: number, rng: () => number): CatState => {
  if (s.over) return s
  const t = s.t + dtMs
  const speed = 0.35 + level * 0.06 + (t / 60000) * 0.35
  let { score, hearts, nextId, spawnIn } = s
  const items: CatItem[] = []
  for (const it of s.items) {
    const y = it.y + (speed * dtMs) / 1000
    if (y >= CATCH_Y && Math.abs(it.x - catX) <= CATCH_W) {
      if (it.kind === 'food') score++
      else hearts--
    } else if (y < 1.05) items.push({ ...it, y })
  }
  spawnIn -= dtMs
  while (spawnIn <= 0) {
    const sock = rng() < 0.2
    const x = 0.05 + rng() * 0.9
    items.push({ id: nextId++, x, y: 0, kind: sock ? 'sock' : 'food', emoji: sock ? '🧦' : FOOD[Math.floor(rng() * FOOD.length)] })
    spawnIn += Math.max(380, 900 - t / 100)
  }
  return { t, catX, items, score, hearts, nextId, spawnIn, over: hearts <= 0 || t >= CAT_MS }
}
