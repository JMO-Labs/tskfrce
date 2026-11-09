import { useSyncExternalStore } from 'react'

type Query = Record<string, string | string[] | undefined>
type PopHandler = (s: { as?: string; url?: string }) => boolean
type Target = { pathname?: string; query?: Query }

const subs = new Set<() => void>()
let version = 0
const notify = () => { version++; subs.forEach((f) => f()) }
// like the real router, query values come back as strings
const clean = (q: Query = {}): Query => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Array.isArray(v) ? v : String(v)]))
const pathOf = (q: Query) => {
  const qs = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (Array.isArray(v) ? v : [v ?? '']).map((x) => [k, x] as [string, string]))).toString()
  return fakeRouter.pathname + (qs ? `?${qs}` : '')
}
const sync = () => {
  fakeRouter.query = fakeRouter.stack[fakeRouter.stack.length - 1]
  fakeRouter.asPath = pathOf(fakeRouter.query)
  notify()
}

type Handler = (...a: unknown[]) => void
const handlers: Record<string, Set<Handler>> = {}
/** Stand-in for next/router. push appends to stack, replace overwrites the top, back pops. */
export const fakeRouter = {
  pathname: '/x',
  asPath: '/x',
  query: {} as Query,
  stack: [{}] as Query[],
  push: jest.fn((t: Target) => { fakeRouter.pathname = t.pathname ?? fakeRouter.pathname; fakeRouter.stack.push(clean(t.query)); sync() }),
  replace: jest.fn((t: Target) => { fakeRouter.pathname = t.pathname ?? fakeRouter.pathname; fakeRouter.stack[fakeRouter.stack.length - 1] = clean(t.query); sync() }),
  beforePopState: jest.fn((cb: PopHandler) => { fakeRouter.popHandler = cb }),
  popHandler: (() => true) as PopHandler,
  events: {
    on: (e: string, f: Handler) => { (handlers[e] ??= new Set()).add(f) },
    off: (e: string, f: Handler) => { handlers[e]?.delete(f) },
    // like Next: a handler that throws aborts the navigation
    emit: (e: string, ...a: unknown[]) => { handlers[e]?.forEach((f) => f(...a)) },
  },
  back: jest.fn(() => { const to = pathOf(fakeRouter.stack[Math.max(0, fakeRouter.stack.length - 2)]); if (!fakeRouter.popHandler({ as: to, url: to })) return; if (fakeRouter.stack.length > 1) fakeRouter.stack.pop(); sync() }),
  reset(pathname = '/x', query: Query = {}) {
    fakeRouter.push.mockClear(); fakeRouter.replace.mockClear(); fakeRouter.back.mockClear(); fakeRouter.beforePopState.mockClear(); fakeRouter.popHandler = () => true
    fakeRouter.pathname = pathname
    fakeRouter.stack = [clean(query)]
    sync()
  },
}

export function useFakeRouter() {
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb) } }, () => version, () => version)
  return fakeRouter
}
