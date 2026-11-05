/** Home-screen install plumbing: service worker registration and the captured install prompt. */
export type InstallPromptEvent = Event & { prompt(): Promise<void> }

let saved: InstallPromptEvent | null = null
const subs = new Set<() => void>()
let listening = false

const defaults = () => ({
  secure: typeof window !== 'undefined' && window.isSecureContext,
  sw: typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  prod: process.env.NODE_ENV === 'production',
})

/** Registers /sw.js. Needs HTTPS (or localhost), a supporting browser and a production build. */
export async function registerSw(
  env: { secure: boolean; sw?: ServiceWorkerContainer; prod: boolean } = defaults(),
): Promise<void> {
  if (!env.secure || !env.prod || !env.sw) return
  try {
    await env.sw.register('/sw.js', { scope: '/' })
  } catch {
    /* the app works fine without the offline page */
  }
}

/** Keeps the browser's install prompt so a button can show it later. Safe to call twice. */
export function listenInstallPrompt(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    saved = e as InstallPromptEvent
    subs.forEach((cb) => cb())
  })
}

export const installPrompt = (): InstallPromptEvent | null => saved

/** Calls cb when an install prompt becomes available. Returns an unsubscribe function. */
export function onInstallPrompt(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}
