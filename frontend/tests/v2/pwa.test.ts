/** @jest-environment jsdom */
import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { installPrompt, listenInstallPrompt, onInstallPrompt, registerSw } from '@/v2/pwa'

const sw = (register: jest.Mock) => ({ register }) as unknown as ServiceWorkerContainer

describe('registerSw', () => {
  it('registers in a secure production page', async () => {
    const register = jest.fn().mockResolvedValue({})
    await registerSw({ secure: true, prod: true, sw: sw(register) })
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })
  it.each([
    ['insecure', { secure: false, prod: true }],
    ['dev', { secure: true, prod: false }],
    ['unsupported', { secure: true, prod: true, noSw: true }],
  ])('does nothing when %s', async (_n, o) => {
    const register = jest.fn()
    await registerSw({ secure: o.secure, prod: o.prod, sw: 'noSw' in o ? undefined : sw(register) })
    expect(register).not.toHaveBeenCalled()
  })
  it('swallows a failed register', async () => {
    const register = jest.fn().mockRejectedValue(new Error('nope'))
    await expect(registerSw({ secure: true, prod: true, sw: sw(register) })).resolves.toBeUndefined()
  })
})

describe('install prompt', () => {
  it('keeps the event and notifies once', () => {
    const cb = jest.fn()
    const off = onInstallPrompt(cb)
    listenInstallPrompt()
    listenInstallPrompt()
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: jest.fn() })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(installPrompt()).toBe(ev)
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })
})

describe('public/sw.js', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8')
  const load = () => {
    const on: Record<string, (e: any) => void> = {}
    const self = { addEventListener: (t: string, f: (e: any) => void) => (on[t] = f), clients: { claim: jest.fn() } }
    vm.runInNewContext(code, { self, caches: { match: jest.fn() }, fetch: jest.fn().mockResolvedValue({}) })
    return on
  }
  const fetchEvent = (url: string, mode: string) => ({ request: { url, mode }, respondWith: jest.fn() })

  it('answers page loads only', () => {
    const on = load()
    const nav = fetchEvent('/', 'navigate')
    on.fetch(nav)
    expect(nav.respondWith).toHaveBeenCalled()
    const api = fetchEvent('/api/proxy/kid/today', 'cors')
    on.fetch(api)
    expect(api.respondWith).not.toHaveBeenCalled()
  })
  it('precaches only the shell and drops old caches', async () => {
    const cache = { addAll: jest.fn().mockResolvedValue(undefined) }
    const del = jest.fn().mockResolvedValue(true)
    const caches = { open: jest.fn().mockResolvedValue(cache), keys: jest.fn().mockResolvedValue(['old', 't4ce-shell-v1']), delete: del }
    const on: Record<string, (e: any) => void> = {}
    const claim = jest.fn()
    vm.runInNewContext(code, { self: { addEventListener: (t: string, f: any) => (on[t] = f), clients: { claim } }, caches })
    let p: Promise<unknown> = Promise.resolve()
    on.install({ waitUntil: (x: Promise<unknown>) => (p = x) })
    await p
    expect(cache.addAll).toHaveBeenCalledWith(['/offline.html', '/icons/icon-192.png'])
    on.activate({ waitUntil: (x: Promise<unknown>) => (p = x) })
    await p
    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('old')
    expect(claim).toHaveBeenCalled()
  })
})
