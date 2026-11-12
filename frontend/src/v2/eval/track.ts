import { api, KID_TOKEN_KEY } from '@/v2/api'
import { tokenManager } from '@/services/tokenManager'

export type EvalEvent = 'screen_view' | 'auth' | 'feature' | 'wizard_step' | 'wizard_done' | 'form_abandoned' | 'error_shown' | 'game' | 'setup_detail'
type Props = Record<string, string | number>
interface Pending { name: EvalEvent; props: Props }

const MAX_BUFFER = 20
let buffer: Pending[] = []

export function _resetTrack(): void {
  buffer = []
}

function hasKidToken(): boolean {
  try {
    return !!localStorage.getItem(KID_TOKEN_KEY)
  } catch {
    return false
  }
}

function send(e: Pending, kid?: boolean): void {
  api('/eval/event', { method: 'POST', body: e, kid }).catch(() => {})
}

/** Pre-login events the box accepts without a token (mirrors the backend anon-event gate). */
const anonOk = (e: Pending): boolean =>
  e.name === 'auth' || e.name === 'screen_view' || (e.name === 'feature' && e.props.area === 'wifi')

/** Fire and forget usage event. Never throws, never toasts. Pre-login events go to anon-event when allowed, else wait in memory. */
export function track(name: EvalEvent, props: Props = {}, opts: { kid?: boolean } = {}): void {
  try {
    const e = { name, props }
    if (opts.kid) {
      if (hasKidToken()) send(e, true)
      return
    }
    if (!tokenManager.getAccessToken()) {
      if (anonOk(e)) {
        api('/eval/anon-event', { method: 'POST', body: e }).catch(() => {})
        return
      }
      buffer.push(e)
      if (buffer.length > MAX_BUFFER) buffer.shift()
      return
    }
    const queued = buffer
    buffer = []
    queued.forEach((q) => send(q))
    send(e)
  } catch {
    /* telemetry must never break the app */
  }
}
