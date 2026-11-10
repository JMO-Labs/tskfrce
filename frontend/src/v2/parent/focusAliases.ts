import { useEffect } from 'react'
import { useRouter } from 'next/router'
import type { Query } from './useFocusParam'

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

/** Maps an old parent link to its new-URL query, or null when nothing changes. */
export function aliasQuery(
  pathname: string,
  query: Query,
  hash: string,
  kidOfRun?: (runId: number) => number | undefined,
): Query | null {
  if (pathname === '/') {
    const { tab, item, chore, kid } = { tab: str(query.tab), item: str(query.item), chore: str(query.chore), kid: str(query.kid) }
    if (tab === 'needs') return { focus: 'needs' }
    if (item) return { kid: item }
    if (chore && !kid) {
      if (!kidOfRun) return null
      const k = kidOfRun(Number(chore))
      return k === undefined ? { focus: 'needs' } : { kid: String(k), chore }
    }
    return null
  }
  if (pathname === '/kids') {
    const kid = str(query.kid), item = str(query.item), section = str(query.section)
    if (kid && !item) {
      if (section === 'chores') return { section: 'chores', item: 'new' }
      const q: Query = { section: 'kids', item: kid }
      if (str(query.pin) === '1') Object.assign(q, { open: 'settings', edit: '1', pin: '1' })
      else if (hash === '#trust') q.open = 'trust'
      return q
    }
    if (section === 'kids' && item && hash === '#trust' && !query.open) return { ...query, open: 'trust' }
  }
  return null
}

/** Rewrites old links to the new focus URLs with router.replace. */
export function useFocusAliases(kidOfRun?: (runId: number) => number | undefined): void {
  const router = useRouter()
  useEffect(() => {
    if (router.isReady === false) return
    const q = aliasQuery(router.pathname, router.query, window.location.hash, kidOfRun)
    if (q) router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true, scroll: false })
  }, [router, router.pathname, router.query, router.isReady, kidOfRun])
}
