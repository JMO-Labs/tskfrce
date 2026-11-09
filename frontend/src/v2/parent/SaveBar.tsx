import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/router'
import { ConfirmDelete } from '@/v2/manage/ConfirmDelete'
import { Icon } from './Icon'

/** Sticky "Unsaved changes" bar for multi-field forms. Renders nothing until something changed. */
export function SaveBar({ dirty, saving, onSave, onCancel, saveLabel = 'Save', disabled, note }: {
  dirty: boolean; saving: boolean; onSave: () => void; onCancel: () => void; saveLabel?: string; disabled?: boolean; note?: ReactNode
}) {
  if (!dirty) return null
  return (
    <div className="p-savebar" role="region" aria-label="Unsaved changes">
      <span className="p-savebar-note" title={typeof note === 'string' ? note : undefined}>{note ?? 'Unsaved changes'}</span>
      <button type="button" className="p-btn" onClick={onCancel}>Cancel</button>
      <button type="button" className="p-btn" data-variant="accent" onClick={onSave} disabled={disabled} aria-busy={saving} data-loading={saving || undefined}>
        <Icon name="check" size={16} />{saveLabel}
      </button>
    </div>
  )
}

const FIELD = { test: (e: HTMLElement) => e.matches('input, textarea, select, [contenteditable="true"]') }
const CANCEL = { cancelled: true, message: 'Route change cancelled: unsaved changes' }
type PopHandler = (state?: { as?: string }) => boolean
const sameRecord = (a: string, b: string) => {
  const x = new URL(a, 'http://x'), y = new URL(b, 'http://x')
  return x.pathname === y.pathname && ['section', 'item'].every((k) => x.searchParams.get(k) === y.searchParams.get(k))
}
const guards: PopHandler[] = [] // active dirty guards; the newest decides browser Back

/** Confirm before leaving a dirty form: in-app links (guard), tab close and browser Back.
 *  `inRecord: 'allow'` lets Back steps within the same record (closing an open row) through unasked: for forms that outlive their rows. */
export function useDiscardGuard(dirty: boolean, onDiscard?: () => void, { inRecord = 'ask' }: { inRecord?: 'allow' | 'ask' } = {}): { guard: (go: () => void) => void; release: () => void; sheet: ReactNode } {
  const router = useRouter()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const undoing = useRef(false) // history.go(1) is on its way: its popstate is not a new Back
  const leaving = useRef(false) // Discard was chosen: let the popstate / route change / next guard() through, no second prompt
  const field = useRef<HTMLElement | null>(null) // last focused form field: a cancelled leave must hand focus back to it
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const chose = useRef(false) // Discard was clicked (the sheet then closes too); anything else on the sheet means Keep
  const release = useCallback(() => { leaving.current = true }, []) // the form's record is gone (deleted): nothing left to ask about
  const guard = useCallback((go: () => void) => { if (dirty && !leaving.current) setPending(() => go); else go() }, [dirty])
  const routerRef = useRef(router)
  const discardRef = useRef(onDiscard)
  useEffect(() => { routerRef.current = router; discardRef.current = onDiscard })

  useEffect(() => {
    if (!dirty) return
    const r = () => routerRef.current
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const onBack: PopHandler = (state) => {
      if (leaving.current) return true
      if (inRecord === 'allow' && state?.as && sameRecord(r().asPath, state.as)) return true // closes a row, leaves nothing
      if (undoing.current) { undoing.current = false; return false } // the popstate from our own history.go(1) below
      // stay on the page: step forward again (router.push of the current URL would only replace the popped entry), then ask
      undoing.current = true
      window.setTimeout(() => { undoing.current = false }, 500) // if that popstate never comes, a later real Back must still prompt
      window.history.go(1)
      setPending(() => () => { leaving.current = true; r().back() })
      return false
    }
    // in-app links (back link, View as kid, tabs, nav): ask before a navigation that leaves this page's record
    const onStart = (url: string, opts?: { shallow?: boolean }) => {
      if (leaving.current) return
      if (sameRecord(r().asPath, url)) return
      setPending(() => () => { void (opts?.shallow ? r().push(url, undefined, { shallow: true }) : r().push(url)) }) // the event carries only `shallow`, so replace/scroll of the original call can't be known
      r().events?.emit('routeChangeError')
      // Next treats `cancelled` as a quiet abort, but <Link> never catches the rejected push: the dev overlay shows
      // any Error (and blocks the page), so throw a plain object and keep it out of the console.
      throw CANCEL
    }
    const done = () => { leaving.current = false } // the navigation ended (or failed): ask again next time
    const focusIn = (e: FocusEvent) => { const t = e.target; if (t instanceof HTMLElement && FIELD.test(t) && !t.closest('[role="dialog"]')) field.current = t } // fields only: a clicked link must not replace it
    const a0 = document.activeElement
    field.current = a0 instanceof HTMLElement && FIELD.test(a0) ? a0 : null // focused before the form turned dirty; a stale field from an earlier dirty spell must not get Keep's focus
    r().events?.on('routeChangeStart', onStart)
    r().events?.on('routeChangeComplete', done)
    r().events?.on('routeChangeError', done)
    document.addEventListener('focusin', focusIn)
    const quiet = (e: PromiseRejectionEvent) => { if (e.reason === CANCEL) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('unhandledrejection', quiet)
    guards.push(onBack)
    r().beforePopState(onBack)
    return () => {
      r().events?.off('routeChangeStart', onStart)
      r().events?.off('routeChangeComplete', done)
      r().events?.off('routeChangeError', done)
      document.removeEventListener('focusin', focusIn)
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('unhandledrejection', quiet)
      guards.splice(guards.indexOf(onBack), 1)
      r().beforePopState(guards[guards.length - 1] ?? (() => true))
      leaving.current = false
      undoing.current = false
    }
  }, [dirty, inRecord])

  const sheet = (
    <ConfirmDelete opened={!!pending} title="Discard changes?" body="What you changed here won't be saved." confirmLabel="Discard"
      onConfirm={() => { chose.current = true; leaving.current = true; discardRef.current?.(); pending?.() }}
      onClose={() => {
        setPending(null)
        if (!chose.current) { clearTimeout(timer.current); timer.current = window.setTimeout(() => { const a = document.activeElement; if (field.current?.isConnected && (!a || a === document.body || a.closest('[role="dialog"]') || a.matches('a, button'))) field.current.focus() }, 60) } // after Mantine returns focus to the opener; Keep / Esc: back to the field
        chose.current = false
      }} />
  )
  return { guard, release, sheet }
}
