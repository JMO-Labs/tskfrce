import { GAME_INFO } from './catalog'
import { MICROS } from './quick'

const param = (search: string, name: string) => new URLSearchParams(search).get(name)

/** Dev-only screenshot hook: /kid?micro=<key> runs that one microgame on repeat in the Games tab. */
export function devMicro(search: string, env = process.env.NODE_ENV): string | null {
  if (env === 'production') return null
  const key = param(search, 'micro')
  return key && MICROS.some((m) => m.key === key) ? key : null
}

/** Dev-only: /kid?game=<key> plays one thinking game directly. */
export function devGame(search: string, env = process.env.NODE_ENV): string | null {
  if (env === 'production') return null
  const key = param(search, 'game')
  return key && GAME_INFO[key]?.kind === 'think' ? key : null
}
