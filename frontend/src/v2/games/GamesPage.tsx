import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api'
import type { AgeGroup, CelebrateLevel } from '../types'
import { HungryCat } from './hungryCat/HungryCat'
import { QuickFire } from './QuickFire'
import { devMicro } from './devMicro'
import { MICROS } from './quick'
import { GamesWelcome, markWelcomed, welcomeSeen } from './GamesWelcome'
import { Results } from './Results'
import { partScore } from './scoring'
import { Shelf } from './Shelf'
import type { FinishResult, GamePart, StartedPlay } from './types'
import { useFinishGame, useGamesShelf, useStartGame } from './useGames'
import { Wheel } from './Wheel'

type Phase = 'shelf' | 'wheel' | 'play' | 'results'
const msg = (e: unknown) => (e instanceof ApiError ? e.detail : 'Something went wrong. Try again.')

/** Games tab: shelf -> wheel -> play -> results. The server owns every number. */
type Props = { mode: AgeGroup; celebrate: CelebrateLevel; preview: boolean; autoStart?: boolean; name?: string; kidId?: number | null; /** family time zone for the wake time */ tz?: string }

/** The Games tab. In development, /kid?micro=<key> runs one microgame on repeat (screenshots, play-testing). */
export function GamesPage(p: Props) {
  const [dev] = useState(() => (typeof window === 'undefined' ? null : devMicro(window.location.search)))
  if (dev) return <QuickFire age={p.mode} startLevel={2} seed={1} micros={MICROS.filter((m) => m.key === dev)} onEnd={() => {}} />
  return <GamesFlow {...p} />
}

function GamesFlow({ mode, celebrate, preview, autoStart = false, name = 'your kid', kidId = null, tz }: Props) {
  const shelf = useGamesShelf()
  const start = useStartGame()
  const finish = useFinishGame()
  const [phase, setPhase] = useState<Phase>('shelf')
  const [play, setPlay] = useState<StartedPlay | null>(null)
  const [result, setResult] = useState<FinishResult | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [welcome, setWelcome] = useState(() => !preview && !welcomeSeen(kidId))
  const sent = useRef(false)

  const begin = () => {
    setHint(null)
    start.mutate({}, { onSuccess: (p) => { setPlay(p); setPhase('wheel') }, onError: (e) => setHint(msg(e)) })
  }
  const d = shelf.data
  const auto = useRef(autoStart)
  useEffect(() => {
    if (!auto.current || !d || preview || welcome) return
    auto.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot start from the toast
    if (!d.asleep_until && (d.saved > 0 || d.started)) begin()
  }, [d, preview, welcome]) // eslint-disable-line react-hooks/exhaustive-deps

  const end = (score: number, parts: GamePart[] | null) => {
    if (!play || sent.current) return
    sent.current = true
    setPhase('results')
    setResult(null)
    finish.mutate({ token: play.token, score, parts }, {
      onSuccess: setResult,
      onError: (e) => { sent.current = false; setPlay(null); setHint(msg(e)); setPhase('shelf') },
    })
  }
  const done = () => { sent.current = false; setPlay(null); setResult(null); setPhase('shelf') }

  if (welcome) return <GamesWelcome celebrate={celebrate} seed={kidId ?? 0} onDone={() => { markWelcomed(kidId); setWelcome(false) }} />
  if (phase === 'wheel' && play) return <Wheel slots={play.slots} slot={play.slot} celebrate={celebrate} seed={play.play_id} onDone={() => setPhase('play')} />
  if (phase === 'play' && play)
    return play.game === 'hungry-cat'
      ? <HungryCat level={play.level} seed={play.play_id} onEnd={(score) => end(score, null)} />
      : <QuickFire age={mode} startLevel={play.level} seed={play.play_id} onEnd={(parts) => end(parts.filter((p) => p.ok).reduce((n, p) => n + partScore(p.ms), 0), parts)} />
  if (phase === 'results' && play && result) return <Results r={result} game={play.game} celebrate={celebrate} seed={play.play_id} onDone={done} />
  if (phase === 'results') return <p className="k-hint" role="status">Counting your stars…</p>
  if (!d) return <p className="k-hint" role="status">{shelf.isError ? 'Games will be back in a moment.' : 'Loading games…'}</p>
  return <Shelf d={d} name={name} preview={preview} hint={hint} busy={start.isPending} celebrate={celebrate} seed={kidId ?? 0} tz={tz} onPlay={begin} />
}
