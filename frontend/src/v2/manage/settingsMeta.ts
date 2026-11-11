const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** "5 min ago", "3 h ago", "2 days ago" for an ISO instant. */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (min < 2) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 1440) return `${Math.floor(min / 60)} h ago`
  return `${plural(Math.floor(min / 1440), 'day')} ago`
}

/** Parents list sub-line. */
export const lastActive = (iso: string | null | undefined, now = Date.now()) =>
  iso ? `Last active ${now - Date.parse(iso) < 120_000 ? 'now' : ago(iso, now)}` : 'Never signed in'

export const countLine = (n: number | undefined, one: string, many = `${one}s`) =>
  n === undefined ? undefined : `${n} ${n === 1 ? one : many}`
