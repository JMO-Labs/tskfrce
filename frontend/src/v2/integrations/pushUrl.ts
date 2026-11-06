import { useSyncExternalStore } from 'react'

const PATH = ':3000/api/proxy/integration-local/push'

/** True for names a parent reaches on the home network: RFC 1918 IPv4, localhost, .local, or a bare name. */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return /^[a-z0-9-]+$/.test(h) && !/^\d+$/.test(h) // single label, not a number
}

/** The LAN push URL for this page's host, or the `<box>` placeholder when the host is not local. */
export const pushUrlFor = (host: string | undefined): string => `http://${host && isLocalHost(host) ? host : '<box>'}${PATH}`

/** `{ url, filled }`: filled is false while the `<box>` placeholder is shown (server render or public host). */
export function usePushUrl() {
  const host = useSyncExternalStore(() => () => {}, () => window.location.hostname, () => undefined)
  const url = pushUrlFor(host)
  return { url, filled: !url.includes('<box>') }
}
