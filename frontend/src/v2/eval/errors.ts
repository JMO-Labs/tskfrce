import { ApiError } from '@/v2/api'
import { track } from './track'

const recent: string[] = []

export function errorKind(e: unknown): string {
  if (e instanceof ApiError) return `http_${e.status}`
  return e instanceof TypeError ? 'network' : 'other'
}

/** Remember the kind of an error the parent saw, and count it. */
export function noteError(e: unknown): void {
  try {
    const kind = errorKind(e)
    recent.push(kind)
    if (recent.length > 5) recent.shift()
    track('error_shown', { kind })
  } catch {
    /* telemetry must never break the toast */
  }
}

export function recentErrors(): string[] {
  return [...recent]
}
