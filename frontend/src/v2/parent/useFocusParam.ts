import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'

export type Query = Record<string, string | string[] | undefined>

export interface FocusOptions {
  /** same-level params: removed when this one opens; if one was set, the open uses replace (no new history entry) */
  group?: string[]
  /** deeper params (e.g. 'chore', 'edit', 'pin'): removed when this one opens another id or closes */
  clears?: string[]
  /** values that may be open; any other value is removed with router.replace. undefined = not checked yet (data still loading) */
  valid?: (id: string) => boolean
  /** element that scrolls; default document.scrollingElement ?? document.documentElement */
  scroller?: () => HTMLElement | null
}

export interface OpenOpts {
  /** use router.replace even when nothing was open (open-on-mount defaults) */
  replace?: boolean
  /** extra params set in the same navigation, e.g. { edit: '1' } */
  extra?: Query
}

export interface Focus {
  param: string
  open: string | null
  isOpen(id: string): boolean
  openTo(id: string, opts?: OpenOpts): void
  toggle(id: string): void
  close(): void
}

const NAV = { shallow: true, scroll: false }
// Params whose current history entry was pushed by a focus hook. Shared so a group swap
// (Needs -> kid) hands the pushed entry to the next hook and its close goes Back.
const PUSHED = new Set<string>()
const OVERLAY = '[role="dialog"], .mantine-Popover-dropdown, .mantine-Menu-dropdown'

/** React never fires onBlur for a field that is removed while focused, so blur it first: a blur-autosave field then saves. */
function blurOpenBody() {
  const a = document.activeElement
  if (a instanceof HTMLElement && a.closest('.p-srow-body')) a.blur()
}

function without(q: Query, keys: string[]): Query {
  const out = { ...q }
  for (const k of keys) delete out[k]
  return out
}

export function useFocusParam(param: string, opts: FocusOptions = {}): Focus {
  const router = useRouter()
  const raw = router.query[param]
  const open = typeof raw === 'string' ? raw : null
  // Latest values for callbacks and listeners, so they never see a stale router or options.
  const live = useRef({ router, opts, open })
  useEffect(() => { live.current = { router, opts, open } }) // declared first, so it runs before the effects below
  // A navigation is in flight (the real router updates `query` async); repeat taps are ignored until it lands.
  const pending = useRef<string | null>(null)
  useEffect(() => { pending.current = null }, [router.query])
  useEffect(() => () => { PUSHED.delete(param) }, [param])
  const saved = useRef<{ top: number; opener: HTMLElement | null }>({ top: 0, opener: null })
  const prev = useRef<string | null>(open)

  const scrollEl = () => live.current.opts.scroller?.() ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement

  const go = (method: 'push' | 'replace', query: Query) => {
    const r = live.current.router
    r[method]({ pathname: r.pathname, query }, undefined, NAV)
  }

  const openTo = useCallback((id: string, o: OpenOpts = {}) => {
    const { router: r, opts: { group = [], clears = [] } } = live.current
    const extra = o.extra ?? {}
    if (r.query[param] === id && Object.entries(extra).every(([k, v]) => r.query[k] === v)) return
    const key = `open:${id}:${JSON.stringify(extra)}`
    if (pending.current === key) return
    const swapped = group.find((g) => r.query[g] !== undefined)
    const replace = o.replace || r.query[param] !== undefined || swapped !== undefined
    pending.current = key
    go(replace ? 'replace' : 'push', { ...without(r.query, [...group, ...clears]), [param]: id, ...extra })
    if (!replace) PUSHED.add(param)
    else if (swapped !== undefined && PUSHED.delete(swapped)) PUSHED.add(param)
  }, [param])

  const close = useCallback(() => {
    if (pending.current === 'close') return
    blurOpenBody()
    if (PUSHED.has(param)) { pending.current = 'close'; PUSHED.delete(param); live.current.router.back(); return }
    go('replace', without(live.current.router.query, [param, ...(live.current.opts.clears ?? [])]))
  }, [param])

  const toggle = useCallback((id: string) => (live.current.open === id ? close() : openTo(id)), [close, openTo])

  // Scroll and focus bookkeeping, plus the Back-button reset of the "pushed" mark.
  useEffect(() => {
    const before = prev.current
    prev.current = open
    if (open === null) PUSHED.delete(param)
    if (before === null && open !== null) {
      saved.current = { top: scrollEl().scrollTop, opener: document.activeElement as HTMLElement | null }
    } else if (before !== null && open === null) {
      const { top, opener } = saved.current
      const id = before
      requestAnimationFrame(() => {
        scrollEl().scrollTop = top
        if (opener?.isConnected) opener.focus()
        else document.querySelector<HTMLElement>(`[data-focus-head="${id}"]`)?.focus()
      })
    }
  }, [open, param])

  // Back (and any other navigation) unmounts the open body too: commit a focused field first.
  useEffect(() => {
    if (open === null) return
    const { events } = live.current.router
    events?.on('routeChangeStart', blurOpenBody)
    return () => events?.off('routeChangeStart', blurOpenBody)
  }, [open])

  // Esc closes this level unless something on top (overlay) or deeper (clears) wants it.
  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector(OVERLAY)) return
      const { router: r, opts: { clears = [] } } = live.current
      if (clears.some((k) => r.query[k] !== undefined)) return
      e.preventDefault() // one Esc closes one level, whatever order listeners run in
      close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  // Drop a value that is not allowed (only once valid is known).
  const invalid = open !== null && !!opts.valid && !opts.valid(open)
  useEffect(() => {
    if (invalid) go('replace', without(live.current.router.query, [param]))
  }, [invalid, param])

  const isOpen = useCallback((id: string) => open === id, [open])
  return { param, open, isOpen, openTo, toggle, close }
}
