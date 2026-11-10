/** Math Dash: pure question/score logic. Little adds within 10, Kid times tables, Teen fractions/percent. */
import type { AgeGroup } from '../../types'

export const MATH_MS = 60_000
export type Rng = () => number
export interface Q { text: string; answer: number; choices: number[]; correct: number; hide: number[] }
export interface MathState { q: Q; qIdx: number; score: number; streak: number; tier: number; saved: boolean; level: number }

const int = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1))
const shuffle = <T,>(xs: T[], rng: Rng) => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function raw(age: AgeGroup, tier: number, rng: Rng): [string, number] {
  if (age === 'little') {
    const cap = [5, 8, 10, 10][Math.min(3, tier)]
    const a = int(rng, 1, cap - 1), b = int(rng, 1, cap - a)
    return [`${a} + ${b} = ?`, a + b]
  }
  if (age === 'kid') {
    const hi = [5, 7, 10, 10][Math.min(3, tier)]
    const a = int(rng, 2, hi), b = int(rng, 2, hi)
    return [`${a} × ${b} = ?`, a * b]
  }
  if (tier === 0) { const d = int(rng, 2, 4), k = int(rng, 2, 6); return [`1/${d} of ${d * k}`, k] }
  if (tier === 1) { const p = [10, 25, 50][int(rng, 0, 2)]; const base = 20 * int(rng, 1, 5); return [`${p}% of ${base}`, (p * base) / 100] }
  if (tier === 2) { const [n, d] = [[3, 4], [2, 3], [3, 5]][int(rng, 0, 2)]; const k = int(rng, 2, 8); return [`${n}/${d} of ${d * k}`, n * k] }
  const p = [20, 30, 75][int(rng, 0, 2)], base = 40 * int(rng, 1, 4)
  return [`${p}% of ${base}`, (p * base) / 100]
}

export function makeQ(age: AgeGroup, tier: number, rng: Rng): Q {
  const [text, answer] = raw(age, tier, rng)
  const set = new Set<number>([answer])
  let spread = 1
  while (set.size < 4) {
    const w = answer + int(rng, -3 * spread, 3 * spread)
    if (w >= 0) set.add(w)
    if (set.size < 4 && rng() < 0.2) spread++
  }
  const choices = shuffle([...set], rng)
  const correct = choices.indexOf(answer)
  const hide = shuffle(choices.map((_, i) => i).filter((i) => i !== correct), rng)
  return { text, answer, choices, correct, hide }
}

export const initMath = (age: AgeGroup, level: number, rng: Rng): MathState => {
  const tier = level >= 3 ? 1 : 0
  return { q: makeQ(age, tier, rng), qIdx: 0, score: 0, streak: 0, tier, saved: false, level }
}

export function answerQ(st: MathState, pick: number, age: AgeGroup, upgrades: string[], rng: Rng): MathState {
  const ok = pick === st.q.correct
  let { streak, saved } = st
  if (ok) streak++
  else if (upgrades.includes('streak_saver') && !saved) saved = true
  else streak = 0
  const tier = Math.floor(streak / 3) + (st.level >= 3 ? 1 : 0)
  return { ...st, score: st.score + (ok ? 1 : 0), streak, saved, tier, qIdx: st.qIdx + 1, q: makeQ(age, tier, rng) }
}

/** Round length: extra_time +15%; freeze stops the clock 10 s (same as +10 s). */
export const limitMs = (upgrades: string[], powerUp: string | null) =>
  Math.round(MATH_MS * (upgrades.includes('extra_time') ? 1.15 : 1)) + (powerUp === 'freeze' ? 10_000 : 0)

/** Wrong answers to hide for question idx: hint 1 (first 5), fifty 2 (first 3). */
export const hiddenCount = (idx: number, upgrades: string[], powerUp: string | null) =>
  (upgrades.includes('hint') && idx < 5 ? 1 : 0) + (powerUp === 'fifty' && idx < 3 ? 2 : 0)
