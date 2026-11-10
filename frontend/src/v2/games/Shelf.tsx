import { clockText } from '../clockText'
import type { CelebrateLevel } from '../types'
import { decor, mascotSrc, plural } from './art'
import s from './games.module.css'
import type { GamesShelf } from './types'

const MEDAL = ['🥇', '🥈', '🥉']
const stars = (n: number, rounds: number) => (n > 0 ? '⭐'.repeat(n) : rounds > 0 ? 'Played' : 'New')
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** Games shelf (mockup 6): saved plays, game tiles, weekly board; or the asleep screen. */
export function Shelf({ d, name, preview, hint, busy, celebrate, seed, tz, onPlay }: { d: GamesShelf; tz?: string; name: string; preview: boolean; hint: string | null; busy: boolean; celebrate: CelebrateLevel; seed: number; onPlay: () => void }) {
  const mode = decor(celebrate)
  if (d.asleep_until)
    return (
      <div className={s.root} data-decor={mode}>
        <h2 className={s.h}>Games</h2>
        <div className={s.sleep}>
          <img className={`${s.sleepm} ${s.bob}`} src={mascotSrc(seed)} alt="" />
          <b>Games are asleep</b>
          <small>
            They wake up at {clockText(d.asleep_until, tz)}.<br />
            Your {plural(d.saved, 'saved game')} will be waiting.
          </small>
        </div>
      </div>
    )
  return (
    <div className={s.root} data-decor={mode}>
      <h2 className={s.h}>Games</h2>
      {d.saved > 0 ? (
        <div className={s.saved}>
          🎟️ <b>{plural(d.saved, 'game')} saved</b>
          <button type="button" className={`${s.kb} ${s.sun} ${s.sm}`} disabled={preview || busy} onClick={onPlay}>Play</button>
        </div>
      ) : (
        <div className={s.saved}>🎟️ <span>Finish a chore to earn a game.</span></div>
      )}
      {preview && d.saved > 0 && <p className={s.hint}>Only {name} can play</p>}
      {hint && <p className={s.err} role="status">{hint}</p>}
      <div className={s.tiles}>
        {d.games.map((g) => (
          <div key={g.key} className={s.tile}>
            <span className={s.ge} aria-hidden="true">{g.icon}</span>
            <b>{g.name}</b>
            <small>{stars(g.stars, g.rounds)}</small>
          </div>
        ))}
      </div>
      {d.board && (
        <div className={s.board}>
          <b>This week, {cap(d.board.band)} group</b>
          {d.board.rows.map((r, i) => (
            <div key={r.kid_id}>{`${MEDAL[i] ?? `${i + 1}.`} ${r.me ? 'You' : r.name} · ${r.stars} ⭐`}</div>
          ))}
          <small>Family: {plural(d.family_rounds, 'game')} this week</small>
        </div>
      )}
    </div>
  )
}
