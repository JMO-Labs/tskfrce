/** Pack the Box: fill a grid with pieces. Boxes are cut from the grid, so each is solvable. */
import type { AgeGroup } from '../../types'

export const BOX_MS = 120_000
export const EXTRA_MS = 18_000
export const DIMS: Record<AgeGroup, { w: number; h: number; max: number }> = {
  little: { w: 3, h: 3, max: 2 },
  kid: { w: 4, h: 4, max: 3 },
  teen: { w: 5, h: 4, max: 4 },
}

type Cell = [number, number]
/** cells are in solution orientation; rot (0-3) is the turn the piece is dealt with. */
export interface Piece { id: number; cells: Cell[]; rot: number }
/** cover: -1 empty, -2 blocked, else id of the piece on it. sol: cell -> solution piece id (-2 blocked). */
export interface Game { w: number; h: number; pieces: Piece[]; cover: number[]; sol: number[]; moves: number[] }

const norm = (cs: Cell[]): Cell[] => {
  const r0 = Math.min(...cs.map((c) => c[0])), c0 = Math.min(...cs.map((c) => c[1]))
  return cs.map(([r, c]) => [r - r0, c - c0] as Cell).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** The piece's cells as currently turned, sorted row-major; the first is the anchor. */
export const shapeOf = (p: Piece): Cell[] => {
  let cs = p.cells
  for (let i = 0; i < p.rot % 4; i++) cs = norm(cs.map(([r, c]) => [c, -r] as Cell))
  return norm(cs)
}

export function genBox(age: AgeGroup, tight: number, rng: () => number): Game {
  const { w, h, max } = DIMS[age]
  const sol = Array<number>(w * h).fill(-1)
  const order = Array.from({ length: w * h }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const pMax = Math.min(0.95, 0.25 + 0.1 * tight)
  const pieces: Piece[] = []
  for (const start of order) {
    if (sol[start] !== -1) continue
    const id = pieces.length
    const want = rng() < pMax ? max : 1 + Math.floor(rng() * max)
    const cells = [start]
    sol[start] = id
    while (cells.length < want) {
      const open = cells.flatMap((i) => {
        const r = Math.floor(i / w), c = i % w
        return ([[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as Cell[])
          .filter(([a, b]) => a >= 0 && b >= 0 && a < h && b < w && sol[a * w + b] === -1).map(([a, b]) => a * w + b)
      })
      if (!open.length) break
      const n = open[Math.floor(rng() * open.length)]
      sol[n] = id; cells.push(n)
    }
    pieces.push({ id, cells: norm(cells.map((i) => [Math.floor(i / w), i % w] as Cell)), rot: Math.floor(rng() * 4) })
  }
  return { w, h, pieces, cover: Array(w * h).fill(-1), sol, moves: [] }
}

/** n = boxes packed so far (+ level offset): more n means bigger, fewer pieces. */
export const newGame = genBox

const placedAt = (g: Game, id: number) => g.cover.includes(id)
const cellsAt = (g: Game, id: number, r: number, c: number): Cell[] => {
  const p = g.pieces.find((x) => x.id === id)!
  const sh = shapeOf(p)
  return sh.map(([a, b]) => [a - sh[0][0] + r, b - sh[0][1] + c] as Cell)
}

export function canPlace(g: Game, id: number, r: number, c: number): boolean {
  if (!g.pieces.some((p) => p.id === id) || placedAt(g, id)) return false
  return cellsAt(g, id, r, c).every(([a, b]) => a >= 0 && b >= 0 && a < g.h && b < g.w && g.cover[a * g.w + b] === -1)
}

export function place(g: Game, id: number, r: number, c: number): Game {
  if (!canPlace(g, id, r, c)) return g
  const cover = g.cover.slice()
  cellsAt(g, id, r, c).forEach(([a, b]) => { cover[a * g.w + b] = id })
  return { ...g, cover, moves: [...g.moves, id] }
}

export const lift = (g: Game, id: number): Game =>
  placedAt(g, id) ? { ...g, cover: g.cover.map((v) => (v === id ? -1 : v)), moves: g.moves.filter((m) => m !== id) } : g

export const rotate = (g: Game, id: number): Game =>
  placedAt(g, id) ? g : { ...g, pieces: g.pieces.map((p) => (p.id === id ? { ...p, rot: (p.rot + 1) % 4 } : p)) }

export const isFull = (g: Game) => g.pieces.length > 0 && !g.cover.includes(-1)

/** Power-up: take back the last n placements. */
export function undo(g: Game, n = 3): Game {
  const gone = g.moves.slice(-n)
  return { ...g, cover: g.cover.map((v) => (gone.includes(v) ? -1 : v)), moves: g.moves.slice(0, g.moves.length - gone.length) }
}

/** Turn solution cell i into a blocked cell, lifting whatever sits on it. */
function block(g: Game, i: number): Game {
  const on = g.cover[i]
  const base = on >= 0 ? lift(g, on) : g
  const cover = base.cover.slice(); cover[i] = -2
  const sol = base.sol.slice(); const id = sol[i]; sol[i] = -2
  const rest = sol.map((v, k) => (v === id ? k : -1)).filter((k) => k >= 0)
  const pieces = base.pieces.flatMap((p) => p.id !== id ? [p]
    : rest.length ? [{ ...p, cells: norm(rest.map((k) => [Math.floor(k / g.w), k % g.w] as Cell)) }] : [])
  return { ...base, cover, sol, pieces }
}

const connected = (g: Game, cs: number[]) => {
  if (cs.length < 2) return true
  const seen = new Set([cs[0]]); const q = [cs[0]]
  while (q.length) {
    const i = q.pop()!
    for (const n of cs) if (!seen.has(n) && Math.abs(Math.floor(n / g.w) - Math.floor(i / g.w)) + Math.abs((n % g.w) - (i % g.w)) === 1) { seen.add(n); q.push(n) }
  }
  return seen.size === cs.length
}

/** Power-up: the largest unplaced piece loses one cell (that box cell fills itself). */
export function shrink(g: Game): Game {
  const open = g.pieces.filter((p) => !placedAt(g, p.id))
  if (!open.length) return g
  const p = open.reduce((a, b) => (b.cells.length > a.cells.length ? b : a))
  const cs = g.sol.map((v, k) => (v === p.id ? k : -1)).filter((k) => k >= 0)
  const pick = [...cs].reverse().find((k) => connected(g, cs.filter((x) => x !== k))) ?? cs[0]
  return block(g, pick)
}

/** Upgrade rotate_free: the smallest piece is already in the box. */
export function prefill(g: Game): Game {
  const p = g.pieces.reduce((a, b) => (b.cells.length < a.cells.length ? b : a))
  let out = g
  g.sol.forEach((v, k) => { if (v === p.id) out = block(out, k) })
  return out
}
