import { expect, test } from '@jest/globals'
import { canPlace, genBox, isFull, lift, newGame, place, rotate, shapeOf, shrink, undo, DIMS } from '@/v2/games/packBox/logic'
import { seeded } from '@/v2/games/rng'
import type { AgeGroup } from '@/v2/types'

const ages: AgeGroup[] = ['little', 'kid', 'teen']

/** brute-force solver: fill first empty cell with any unplaced piece in any rotation */
const solvable = (w: number, h: number, blocked: boolean[], shapes: [number, number][][][]): boolean => {
  const cover = blocked.slice()
  const used = shapes.map(() => false)
  const go = (): boolean => {
    const i = cover.indexOf(false)
    if (i < 0) return used.every(Boolean)
    const r0 = Math.floor(i / w), c0 = i % w
    for (let p = 0; p < shapes.length; p++) {
      if (used[p]) continue
      for (const sh of shapes[p]) {
        const [ar, ac] = sh[0]
        const cells = sh.map(([r, c]) => [r - ar + r0, c - ac + c0])
        if (!cells.every(([r, c]) => r >= 0 && c >= 0 && r < h && c < w && !cover[r * w + c])) continue
        cells.forEach(([r, c]) => (cover[r * w + c] = true)); used[p] = true
        if (go()) return true
        cells.forEach(([r, c]) => (cover[r * w + c] = false)); used[p] = false
      }
    }
    return false
  }
  return go()
}

test('generated boxes are always solvable, sized by age', () => {
  for (const age of ages) {
    const { w, h, max } = DIMS[age]
    for (let seed = 1; seed <= 25; seed++) {
      const g = newGame(age, seed % 6, seeded(seed))
      expect(g.w).toBe(w); expect(g.h).toBe(h)
      expect(g.pieces.every((p) => p.cells.length <= max)).toBe(true)
      const area = g.pieces.reduce((n, p) => n + p.cells.length, 0) + g.cover.filter((c) => c === -2).length
      expect(area).toBe(w * h)
      const shapes = g.pieces.map((p) => [0, 1, 2, 3].map((r) => shapeOf({ ...p, rot: r })))
      expect(solvable(w, h, g.cover.map((c) => c === -2), shapes)).toBe(true)
    }
  }
})

test('later boxes use bigger pieces', () => {
  const avg = (n: number) => { let t = 0; for (let s = 1; s <= 30; s++) { const g = genBox('teen', n, seeded(s)); t += g.pieces.length } return t / 30 }
  expect(avg(8)).toBeLessThan(avg(0))
})

test('placement rules: bounds, overlap, rotation', () => {
  let g = genBox('kid', 0, seeded(3))
  g = { ...g, pieces: [{ id: 0, cells: [[0, 0], [0, 1]], rot: 0 }, { id: 1, cells: [[0, 0], [0, 1], [0, 2]], rot: 0 }], cover: Array(16).fill(-1), sol: Array(16).fill(-1) }
  expect(canPlace(g, 0, 0, 3)).toBe(false) // 2-wide at last column
  expect(canPlace(g, 0, 0, 2)).toBe(true)
  g = place(g, 0, 0, 0)
  expect(g.cover.slice(0, 3)).toEqual([0, 0, -1])
  expect(canPlace(g, 1, 0, 1)).toBe(false) // overlap
  g = rotate(g, 1)
  expect(shapeOf(g.pieces[1])).toEqual([[0, 0], [1, 0], [2, 0]])
  expect(canPlace(g, 1, 2, 0)).toBe(false) // 3 tall at row 2 of 4
  expect(canPlace(g, 1, 1, 0)).toBe(true)
  expect(place(g, 0, 3, 3)).toBe(g) // already placed -> unchanged
  g = lift(g, 0)
  expect(g.cover.every((c) => c === -1)).toBe(true)
})

test('isFull and undo / shrink', () => {
  let g = genBox('little', 0, seeded(1))
  const solved = (gg: typeof g) => gg
  expect(isFull(solved(g))).toBe(false)
  // place by the generator's own solution
  g = { ...g, pieces: [{ id: 0, cells: [[0, 0], [0, 1]], rot: 0 }, { id: 1, cells: [[0, 0]], rot: 0 }, { id: 2, cells: [[0, 0]], rot: 0 }], cover: [-1, -1, -1, -2, -2, -2, -2, -2, -2], sol: [0, 0, 1, 2, -2, -2, -2, -2, -2], moves: [] }
  g = place(place(place(g, 0, 0, 0), 1, 0, 2), 2, 1, 0)
  expect(g.moves).toEqual([0, 1])
  expect(isFull(g)).toBe(true)
  g = { ...g, pieces: g.pieces.slice(0, 2) }
  const u = undo(g, 3)
  expect(u.moves).toEqual([]); expect(u.cover.slice(0, 3)).toEqual([-1, -1, -1])
  const sh = shrink({ ...u, pieces: [{ id: 0, cells: [[0, 0], [0, 1], [0, 2]], rot: 0 }], cover: [-1, -1, -1, -2, -2, -2, -2, -2, -2], sol: [0, 0, 0, -2, -2, -2, -2, -2, -2] })
  expect(sh.pieces[0].cells.length).toBe(2)
  expect(sh.cover.filter((c) => c === -1).length).toBe(2)
})
