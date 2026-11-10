import type { CelebrateLevel } from '../types'
import { decor, mascotSrc } from './art'
import s from './games.module.css'
import type { FinishResult } from './types'

const title = (stars: number, game: string) =>
  ['Keep practising!', 'Nice!', game === 'hungry-cat' ? 'Nice catching!' : 'Great run!', 'Amazing!'][Math.min(3, Math.max(0, stars))]

export function pointsLine(r: Pick<FinishResult, 'capped' | 'points'>) {
  if (r.capped && r.points === 0) return "Today's game points are full"
  return r.capped ? `→ +${r.points} pts (today's cap)` : `→ +${r.points} pts toward screen time`
}

/** Round results (mockup 5): stars pop in, tickets to points, new best, badges, Done. */
export function Results({ r, game, celebrate, seed, onDone }: { r: FinishResult; game: string; celebrate: CelebrateLevel; seed: number; onDone: () => void }) {
  return (
    <div className={`${s.root} ${s.res}`} data-decor={decor(celebrate)}>
      <img className={`${s.resm} ${s.wave}`} src={mascotSrc(seed)} alt="" />
      <h2>{title(r.stars, game)}</h2>
      <div className={s.stars} role="img" aria-label={`${r.stars} of 3 stars`}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`${s.s} ${s[`s${n}`]} ${n > r.stars ? s.off : ''}`} aria-hidden="true">⭐</span>
        ))}
      </div>
      <div className={s.tick}>
        <span>{`🎟️ +${r.tickets} ${r.tickets === 1 ? 'ticket' : 'tickets'}`}</span>
        <small>{pointsLine(r)}</small>
      </div>
      {r.new_best && <span className={s.chip}>New best!</span>}
      {r.badges.map((b) => (
        <div key={b.key} className={`${s.badge} ${s.pop2}`}>
          🏅 New badge: <b>{b.name}</b>
        </div>
      ))}
      <button type="button" className={`${s.kb} ${s.sun} ${s.wide}`} onClick={onDone}>Done</button>
    </div>
  )
}
