import { useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { NeedsItem } from '../types'
import { useApproveChore, useSendBack } from '../hooks/useToday'
import { useDecideRedemption } from '../hooks/useRewards'
import { useDecideHomework } from '../hooks/useHomeworkRequest'
import { useGoalAction } from '../hooks/useGoals'
import { openChatAfterNav } from '../chat/dock'
import { errorText } from '../errorText'
import { toastFail, toastOk } from '../notify'

/** Chores, redos and integration check-offs are runs (id = run id); the rest are requests. */
export const isGoal = (i: NeedsItem) => i.type === 'goal_full' || i.type === 'goal_suggested'
export const isChore = (i: NeedsItem) => i.type === 'chore' || i.type === 'redo' || i.type === 'integration'

/** What a parent can do with a "needs you" item; shared by the Needs list and the kid focus. */
export function useNeedsActions() {
  const router = useRouter()
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['today'] }) // a failed item may be gone or already handled
  const approveRun = useApproveChore()
  const sendBackRun = useSendBack()
  const decide = useDecideRedemption()
  const decideHw = useDecideHomework()
  const goal = useGoalAction()
  const [busy, setBusy] = useState<string | null>(null)
  const lock = useRef(false) // synchronous guard: Enter-mashing fires before React re-renders

  /** minutes: homework only (default 60). */
  const approveOne = (i: NeedsItem, minutes = 60) =>
    isChore(i)
      ? approveRun.mutateAsync(i.id)
      : i.type === 'homework'
        ? decideHw.mutateAsync({ id: i.id, approve: true, minutes })
        : decide.mutateAsync({ id: i.id, approve: true })
  const run = (go: () => Promise<unknown>, ok: string, key: string) => {
    if (lock.current) return Promise.resolve(false)
    lock.current = true
    setBusy(key)
    return go()
      .then(
        () => (toastOk(ok), true),
        (e) => (toastFail(e), refresh(), false),
      )
      .finally(() => ((lock.current = false), setBusy(null)))
  }

  return {
    busy,
    approve: (i: NeedsItem, minutes?: number) => run(() => approveOne(i, minutes), 'Approved', `a${i.type}${i.id}`),
    /** Approve every item, one by one; a failure doesn't stop the rest and the toast counts both. */
    approveAll: async (items: NeedsItem[]) => {
      if (lock.current) return
      lock.current = true
      setBusy('all')
      let n = 0
      let failed: unknown[] = []
      for (const i of items) {
        try {
          await approveOne(i)
          n++
        } catch (e) {
          failed = [...failed, e]
        }
      }
      lock.current = false
      setBusy(null)
      if (failed.length) refresh()
      if (n) toastOk(n === 1 ? 'Approved' : `Approved ${n} items`)
      if (failed.length) {
        notifications.show({
          title: `${failed.length} ${failed.length === 1 ? 'item' : 'items'} not approved`,
          message: errorText(failed[0]),
          color: 'fridgeRed',
        })
      }
    },
    sendBack: (runId: number, note: string) => run(() => sendBackRun.mutateAsync({ id: runId, note }), 'Sent back', `s${runId}`),
    /** A full goal is done: the parent has handed over the real thing. */
    fulfill: (i: NeedsItem) => run(() => goal.mutateAsync({ id: i.id, action: 'fulfill' }), 'Fulfilled', `f${i.id}`),
    /** A suggested goal needs a price, set in the Goals pane. */
    setPrice: () => void router.push('/kids?section=rewards&item=goals'),
    /** Screen-time, reward and homework requests. */
    decline: (i: NeedsItem) =>
      run(() => (i.type === 'homework' ? decideHw : decide).mutateAsync({ id: i.id, approve: false }), 'Declined', `d${i.id}`),
    /** Open the chore's thread on its kid (chore and note items: id is the run id). */
    reply: (i: NeedsItem) => {
      void router.push({
        pathname: '/',
        query: i.kid_id == null ? { chore: String(i.id) } : { kid: String(i.kid_id), chore: String(i.id) },
      })
      openChatAfterNav('chore', String(i.id))
    },
  }
}

export type NeedsActions = ReturnType<typeof useNeedsActions>
