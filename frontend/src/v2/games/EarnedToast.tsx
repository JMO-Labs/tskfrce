import type { CelebrateLevel } from '../types'
import { decor, mascotSrc } from './art'
import s from './games.module.css'

/** "You earned a game!" card shown above the chores (mockup 1). */
export function EarnedToast({ saved, onPlay, onSave, celebrate, seed = 0 }: { saved: number; onPlay: () => void; onSave: () => void; celebrate: CelebrateLevel; seed?: number }) {
  return (
    <section className={s.root} data-decor={decor(celebrate)} aria-label="Game earned">
      <div className={`${s.toast} ${s.pop}`}>
        <img className={s.toastm} src={mascotSrc(seed)} alt="" />
        <div>
          <b>You earned a game!</b>
          <small>{saved} saved · play now or later</small>
        </div>
      </div>
      <div className={`${s.btns} ${s.pop2}`}>
        <button type="button" className={`${s.kb} ${s.sun}`} onClick={onPlay}>▶ Play now</button>
        <button type="button" className={s.kb} onClick={onSave}>Save it</button>
      </div>
    </section>
  )
}
