import { useEffect, useState, type ReactNode } from 'react'
import { ChatDock } from '../chat/ChatDock'
import { openChat, openChatList, OPEN_CHAT_EVENT, OPEN_CHAT_LIST_EVENT } from '../chat/dock'
import { useNow } from '../today/useClock'
import { useThreads } from '../hooks/useChat'
import { useInbox } from '../hooks/useInbox'
import { useMarkSeen } from '../hooks/useKid'
import { askOnFirstClick, useOsNotify } from '../osNotify'
import type { KidToday } from '../types'
import { AlertsMoved } from './AlertsMoved'
import { CelebrationLayer } from './celebrate/CelebrationLayer'
import { GoalParty } from './celebrate/GoalParty'
import { useCelebrationTriggers } from './celebrate/triggers'
import { useCelebrate } from './celebrate/useCelebrate'
import { useFreezeNotice } from './freezeNotice'
import { KidAlerts } from './KidAlerts'
import { Locker } from './Locker'
import { kidSort, tally } from './kidChips'
import { KidNav, type KidTab } from './KidNav'
import { HappyHourBanner } from './HappyHourBanner'
import { PenaltyCards } from './PenaltyCard'
import { MePage } from './MePage'
import { KidMode } from './modes/KidMode'
import { LittleMode } from './modes/LittleMode'
import { TeenMode } from './modes/TeenMode'
import { RewardsSection } from './RewardsSection'

const MODES = { little: LittleMode, kid: KidMode, teen: TeenMode }
const noop = () => {}

export interface KidAppProps {
  d: KidToday
  name: string
  avatar: string | null
  kidId?: number | null
  preview: boolean
  onExit: () => void
  onLocker: () => void
  /** Customize open (a Me sub-view) */
  lockerOpen?: boolean
  onLockerClose?: () => void
  canSwitch: boolean
  done: { mutate: (id: number, opts?: { onSuccess?: () => void; onError?: () => void }) => void; isPending: boolean; variables?: number }
  /** an award card is up: celebrations wait for it */
  holdCelebrations?: boolean
  /** shown above the chores (first-visit intro) */
  children?: ReactNode
}

/** The kid app: full-width shell, age-mode nav, and the Chores / Rewards / Alerts / Me tabs. */
export function KidApp({ d, name, avatar, kidId, preview, onExit, onLocker, lockerOpen = false, onLockerClose, canSwitch, done, holdCelebrations = false, children }: KidAppProps) {
  const [chosen, setTab] = useState<KidTab>('chores')
  const showLocker = lockerOpen && !!d.progress
  const tab = showLocker ? 'me' : chosen
  const [focusId, setFocusId] = useState<number | null>(null)
  const mode = d.age_group === 'little' || d.age_group === 'teen' ? d.age_group : 'kid'
  const seen = useMarkSeen()
  const now = useNow()
  const threads = useThreads(true, !preview && mode !== 'little')
  const inbox = useInbox(true, !preview && mode !== 'little')
  useOsNotify(inbox.data?.items, noop) // OS pop-ups while the tab is in the background, as the old bell did
  useEffect(() => {
    if (!preview) askOnFirstClick()
  }, [preview])
  const chat = !preview && mode !== 'little' // Chat is a tab here, hosted by an always-mounted inline ChatDock
  useEffect(() => {
    if (!chat) return
    const show = () => setTab('chat')
    window.addEventListener(OPEN_CHAT_EVENT, show)
    window.addEventListener(OPEN_CHAT_LIST_EVENT, show)
    return () => {
      window.removeEventListener(OPEN_CHAT_EVENT, show)
      window.removeEventListener(OPEN_CHAT_LIST_EVENT, show)
    }
  }, [chat])
  const [partyShowing, setPartyShowing] = useState(false)
  const cel = useCelebrate({ level: d.celebrate ?? (mode === 'teen' ? 'small' : 'full'), mode, kidLevel: d.progress?.level ?? 1, hold: holdCelebrations || partyShowing })
  const submit = useCelebrationTriggers(d, kidId, cel.fire, !preview)
  useFreezeNotice(d.progress?.frozen, kidId, !preview)
  const onDone = (id: number) => {
    const c = d.chores.find((x) => x.id === id)
    // marked before the request goes out (polls racing an auto-approve); a double tap sends nothing
    if (c && !submit.tap(c)) return
    done.mutate(id, { onSuccess: () => c && submit.sent(c), onError: () => c && submit.failed(c) })
  }
  const Mode = MODES[mode]
  const goChore = () => {
    const first = kidSort(d.chores, now).find((c) => c.state === 'todo')
    const el = first && document.querySelector<HTMLElement>(`[data-celebrate-id="${first.id}"]`)
    el?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }
  const badges = {
    chores: tally(d.chores).todo,
    chat: threads.data?.total ?? 0,
    alerts: inbox.data?.unread ?? 0,
  }
  const onTab = (t: KidTab) => {
    setFocusId(null)
    onLockerClose?.()
    if (t === 'chat' && chat) openChatList() // the event above switches the tab
    else setTab(t)
  }
  const elsewhere = <p className="k-hint k-elsewhere">{`Alerts and chat show on ${name}'s own screen.`}</p>

  let body: ReactNode
  if (showLocker && d.progress)
    body = <Locker name={name} avatar={avatar} level={d.progress.level} title={d.progress.title} onClose={() => {
      onLockerClose?.()
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-customize]')?.focus()) // Me re-mounts first
    }} />
  else if (tab === 'rewards')
    body = (
      <RewardsSection onExpired={onExit} mode={mode} />
    )
  else if (tab === 'me')
    body = (
      <MePage name={name} avatar={avatar} progress={d.progress} preview={preview} onLocker={onLocker} canSwitch={canSwitch} onExit={onExit} kidId={kidId} little={mode === 'little'} mode={mode} celebrate={d.celebrate ?? (mode === 'teen' ? 'small' : 'full')} freezes={d.progress?.freezes_held} trust={d.trust} />
    )
  else if (tab === 'chat') body = chat ? null : elsewhere
  else if (tab === 'alerts') body = preview ? elsewhere : <KidAlerts
        onChores={(id) => {
          setFocusId(id)
          setTab('chores')
        }}
      />
  else
    body = (
      <>
        {children}
        <HappyHourBanner hh={d.happy_hour} onGo={goChore} />
        <PenaltyCards list={d.penalties} jail={d.jail_cards} done={done} />
        <Mode
          d={d}
          focusId={focusId}
          name={name}
          avatar={avatar}
          now={now}
          onDone={onDone}
          busyId={done.isPending ? done.variables ?? null : null}
          onSeen={seen.mutate}
          onChat={preview || mode === 'little' ? undefined : (id) => openChat('chore', String(id))}
        />
      </>
    )

  return (
    <div className="k-app" data-mode={mode}>
      <KidNav mode={mode} tab={tab} onTab={onTab} badges={badges} avatar={avatar} />
      <main className="k-main">
        {!preview && <AlertsMoved />}
        <div className="k-inner" hidden={tab === 'chat' && chat}>
          {body}
        </div>
        {chat && (
          <div className="k-inner k-chatpane" hidden={tab !== 'chat'}>
            <h1 className="k-hi k-disp">Chat</h1>
            <ChatDock kid inline meId={kidId ?? null} meName={name} />
          </div>
        )}
      </main>
      <CelebrationLayer cel={cel} balance={d.points_balance} />
      {!preview && <GoalParty onExpired={onExit} celebrate={d.celebrate ?? (mode === 'teen' ? 'small' : 'full')} onShowing={setPartyShowing} />}
    </div>
  )
}
