import { useSyncExternalStore } from 'react'

type Query = Record<string, string | string[] | undefined>
type Target = { pathname?: string; query?: Query }

const subs = new Set<() => void>()
let version = 0
const notify = () => { version++; subs.forEach((f) => f()) }
const clean = (q: Query = {}): Query => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined))
const sync = () => {
  fakeRouter.query = fakeRouter.stack[fakeRouter.stack.length - 1]
  const qs = new URLSearchParams(Object.entries(fakeRouter.query).flatMap(([k, v]) => (Array.isArray(v) ? v : [v ?? '']).map((x) => [k, x] as [string, string]))).toString()
  fakeRouter.asPath = fakeRouter.pathname + (qs ? `?${qs}` : '')
  notify()
}

/** Stand-in for next/router. push appends to stack, replace overwrites the top, back pops. */
export const fakeRouter = {
  pathname: '/x',
  asPath: '/x',
  query: {} as Query,
  stack: [{}] as Query[],
  push: jest.fn((t: Target) => { fakeRouter.pathname = t.pathname ?? fakeRouter.pathname; fakeRouter.stack.push(clean(t.query)); sync() }),
  replace: jest.fn((t: Target) => { fakeRouter.pathname = t.pathname ?? fakeRouter.pathname; fakeRouter.stack[fakeRouter.stack.length - 1] = clean(t.query); sync() }),
  back: jest.fn(() => { if (fakeRouter.stack.length > 1) fakeRouter.stack.pop(); sync() }),
  reset(pathname = '/x', query: Query = {}) {
    fakeRouter.push.mockClear(); fakeRouter.replace.mockClear(); fakeRouter.back.mockClear()
    fakeRouter.pathname = pathname
    fakeRouter.stack = [clean(query)]
    sync()
  },
}

export function useFakeRouter() {
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb) } }, () => version, () => version)
  return fakeRouter
}
