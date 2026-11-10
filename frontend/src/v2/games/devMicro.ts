import { MICROS } from './quick'

/** Dev-only screenshot hook: /kid?micro=<key> runs that one microgame on repeat in the Games tab. */
export function devMicro(search: string, env = process.env.NODE_ENV): string | null {
  if (env === 'production') return null
  const key = new URLSearchParams(search).get('micro')
  return key && MICROS.some((m) => m.key === key) ? key : null
}
