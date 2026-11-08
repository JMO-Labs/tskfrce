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
      <span className="p-savebar-note">{note ?? 'Unsaved changes'}</span>
      <button type="button" className="p-btn" onClick={onCancel}>Cancel</button>
      <button type="button" className="p-btn" data-variant="accent" onClick={onSave} disabled={disabled} aria-busy={saving} data-loading={saving || undefined}>
        <Icon name="check" size={16} />{saveLabel}
      </button>
    </div>
  )
}

const CANCEL = { cancelled: true, message: 'Route change cancelled: unsaved changes' }
type PopHandler = () => boolean
const guards: PopHandler[] = [] // active dirty guards; the newest decides browser Back

/** Confirm before leaving a dirty form: in-app links (guard), tab close and browser Back. */
export function useDiscardGuard(dirty: boolean, onDiscard?: () => void): { guard: (go: () => void) => void; release: () => void; sheet: ReactNode } {
  const router = useRouter()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const undoing = useRef(false) // history.go(1) is on its way: its popstate is not a new Back
  const leaving = useRef(false) // Discard was chosen: let the popstate / route change / next guard() through, no second prompt
  const field = useRef<HTMLElement | null>(null) // last focused form field: a cancelled leave must hand focus back to it
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
    const onBack: PopHandler = () => {
      if (leaving.current) return true
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
      const here = new URL(r().asPath, 'http://x'), to = new URL(url, 'http://x')
      if (here.pathname === to.pathname && ['section', 'item'].every((k) => here.searchParams.get(k) === to.searchParams.get(k))) return
      setPending(() => () => { void r().push(url, undefined, opts?.shallow ? { shallow: true } : undefined) }) // the event carries only `shallow`, so replace/scroll of the original call can't be known
      r().events?.emit('routeChangeError')
      // Next treats `cancelled` as a quiet abort, but <Link> never catches the rejected push: the dev overlay shows
      // any Error (and blocks the page), so throw a plain object and keep it out of the console.
      throw CANCEL
    }
    const done = () => { leaving.current = false } // the navigation ended (or failed): ask again next time
    const focusIn = (e: FocusEvent) => { const t = e.target; if (t instanceof HTMLElement && !t.closest('[role="dialog"]') && t !== document.body) field.current = t }
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
  }, [dirty])

  const sheet = (
    <ConfirmDelete opened={!!pending} title="Discard changes?" body="What you changed here won't be saved." confirmLabel="Discard"
      onConfirm={() => { chose.current = true; leaving.current = true; discardRef.current?.(); pending?.() }}
      onClose={() => {
        setPending(null)
        if (!chose.current) window.setTimeout(() => { if (field.current?.isConnected) field.current.focus() }, 60) // after Mantine returns focus to the opener; Keep / Esc: back to the field
        chose.current = false
      }} />
  )
  return { guard, release, sheet }
}
