/** Comic words for celebrations (spec 1: 12 or more, sized to fit the screen). */
export const WORDS = [
  'POW!',
  'BAM!',
  'ZAP!',
  'BOOM!',
  'KAPOW!',
  'WHAM!',
  'WOW!',
  'AWESOME!',
  'COOL!',
  'ROAR-SOME!',
  'GROOVY!',
  'ACHOO!',
  'YES!',
  'NAILED IT!',
] as const

/** What a mascot's speech bubble says. */
export const SAYS = ['WOW!', 'AWESOME!', 'COOL!', 'ROAR-SOME!', 'YES!'] as const

// Impact caps run about 0.55em; fallbacks (Arial Black, system-ui 900) up to 0.7em, so size for the wider one.
// W/M are wider, I ! - ' and spaces narrower; the stroke and 4px shadow add a little.
const EM = 0.7
const PAD = 10
const wide = (w: string) => [...w].reduce((n, ch) => n + (/[WM]/.test(ch) ? 0.95 : /[I!\-' ]/.test(ch) ? 0.42 : EM), 0)

/** Estimated rendered width of a word at a font size, in px. */
export const wordWidth = (word: string, size: number) => wide(word) * size + PAD

/** Largest font size (≤ base, ≥ min) at which the word fits maxWidth. */
export function fitWordSize(word: string, maxWidth: number, base = 50, min = 20) {
  const fit = Math.floor((maxWidth - PAD) / Math.max(wide(word), 0.1))
  return Math.max(min, Math.min(base, fit))
}
