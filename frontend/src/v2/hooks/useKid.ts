import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useClientValue } from './useClientValue'
import { api, ApiError, AuthError, KID_TOKEN_KEY } from '../api'
import { blocked, kidInit, useAsKid } from './usePreview'
import { retryIfOffline, toastFail, toastOk } from '../notify'
import type { KidToday, KidWhoami } from '../types'
import type { KidAlert, KidIdentity } from '../types/enroll'
import { clearDevice, saveAlert, saveDevice, saveKid } from '../kid/kidDevice'

const readToken = (): string | null => {
  try {
    return localStorage.getItem(KID_TOKEN_KEY)
  } catch {
    return null
  }
}
const KID_ID_KEY = 'task4ce-kid-id'
const readId = (): number | null => {
  try {
    const v = Number(localStorage.getItem(KID_ID_KEY))
    return v > 0 ? v : null
  } catch {
    return null
  }
}
export const writeToken = (t: string | null, kidId?: number) => {
  try {
    if (t) {
      localStorage.setItem(KID_TOKEN_KEY, t)
      if (kidId) localStorage.setItem(KID_ID_KEY, String(kidId))
    } else {
      localStorage.removeItem(KID_TOKEN_KEY)
      localStorage.removeItem(KID_ID_KEY)
    }
  } catch {
    /* storage blocked: the session just won't survive a reload */
  }
}

export const loginMessage = (e: unknown): string =>
  e instanceof ApiError && e.status === 429
    ? 'Too many tries. Wait a minute and try again.'
    : e instanceof Error
      ? e.message
      : 'Something went wrong. Try again.'

/** Kid session: token in localStorage, whoami, login, logout. */
export function useKidSession(enrolling = false) {
  const qc = useQueryClient()
  // localStorage is client-only: the server render and hydration see "not ready"; login/logout override it
  const ready = useClientValue(() => true, false)
  const storedAuthed = useClientValue(() => !!readToken(), false)
  const storedId = useClientValue(readId, null)
  const [session, setSession] = useState<{ authed: boolean; kidId: number | null } | null>(null)
  const authed = session ? session.authed : storedAuthed
  const kidId = session ? session.kidId : storedId

  const whoami = useQuery({
    queryKey: ['kid', 'whoami'],
    queryFn: () => api<KidWhoami>('/kid/whoami'),
    enabled: !enrolling, // a scanned code signs in first; whoami would be wasted
  })
  const login = useMutation({
    mutationFn: (v: { kid_id: number; pin?: string }) =>
      api<{ access_token: string }>('/kid/login', { method: 'POST', body: v, kid: true }),
    onSuccess: (r, v) => {
      writeToken(r.access_token, v.kid_id)
      setSession({ authed: true, kidId: v.kid_id })
    },
  })
  const enroll = useMutation({
    mutationFn: (token: string) =>
      api<{ access_token: string; device_token: string; kid: KidIdentity; alert: KidAlert | null }>('/kid/enroll', {
        method: 'POST',
        body: { token },
      }),
    onSuccess: (r) => {
      writeToken(r.access_token, r.kid.id)
      saveDevice(r.device_token)
      saveKid(r.kid)
      saveAlert(r.alert)
      setSession({ authed: true, kidId: r.kid.id })
    },
  })
  /** Clear the token (and this phone's device sign-in) and start again at whoami. */
  const logout = () => {
    writeToken(null)
    clearDevice()
    setSession({ authed: false, kidId: null })
    login.reset()
    qc.removeQueries({ queryKey: ['kid', 'today'] })
    qc.invalidateQueries({ queryKey: ['kid', 'whoami'] })
  }
  return { ready, authed, kidId, whoami, login, enroll, logout }
}

/** Kid's chores and lock state, refetched every 10 s. A 401 calls onExpired. */
export function useKidToday(onExpired: () => void) {
  const as = useAsKid()
  const q = useQuery({
    queryKey: ['kid', 'today', as],
    queryFn: () => api<KidToday>('/kid/today', kidInit(as)),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
  const expired = q.error instanceof AuthError
  useEffect(() => {
    if (expired) onExpired()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired])
  return q
}

export function useMarkDone(onExpired: () => void) {
  const qc = useQueryClient()
  const as = useAsKid()
  return useMutation({
    mutationFn: (id: number) => (as ? blocked() : api(`/kid/chores/${id}/done`, { method: 'POST', kid: true })),
    onSuccess: () => toastOk('Marked done'),
    onError: (e: Error) => {
      if (e instanceof AuthError) onExpired()
      else toastFail(e)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['kid', 'today'] }),
  })
}

const refetch = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['kid', 'today'] })

export function useTickSubtask() {
  const qc = useQueryClient()
  const as = useAsKid()
  const m = useMutation({
    mutationFn: (v: { chore: number; sub: number; done: boolean }) =>
      as ? blocked() : api(`/kid/chores/${v.chore}/subtasks/${v.sub}`, { method: 'POST', body: { done: v.done }, kid: true }),
    onError: (e: Error, v) => toastFail(e, () => m.mutate(v)), // a tick is idempotent
    onSettled: () => refetch(qc),
  })
  return m
}

export function useUploadPhoto() {
  const qc = useQueryClient()
  const as = useAsKid()
  const m = useMutation({
    mutationFn: (v: { chore: number; file: File }) => {
      if (as) return blocked()
      const body = new FormData()
      body.append('file', v.file)
      return api(`/kid/chores/${v.chore}/photos`, { method: 'POST', body, kid: true })
    },
    onSuccess: () => toastOk('Photo added'),
    onError: (e: Error, v) => toastFail(e, retryIfOffline(e, () => m.mutate(v))),
    onSettled: () => refetch(qc),
  })
  return m
}

export function useSendNote() {
  const qc = useQueryClient()
  const as = useAsKid()
  const m = useMutation({
    mutationFn: (v: { chore: number; label: string; text?: string }) =>
      as ? blocked() : api(`/kid/chores/${v.chore}/note`, { method: 'POST', body: { label: v.label, text: v.text }, kid: true }),
    onError: (e: Error, v) => toastFail(e, retryIfOffline(e, () => m.mutate(v))),
    onSettled: () => refetch(qc),
  })
  return m
}

/** Mark a chore as opened (clears "New"). Silent no-op while previewing. */
export function useMarkSeen() {
  const qc = useQueryClient()
  const as = useAsKid()
  return useMutation({
    mutationFn: async (id: number) => {
      if (!as) await api(`/kid/chores/${id}/seen`, { method: 'POST', kid: true })
    },
    onSettled: () => refetch(qc),
  })
}
