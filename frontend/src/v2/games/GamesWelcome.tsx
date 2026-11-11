import type { CelebrateLevel } from '../types'
import { decor, mascotSrc } from './art'
import s from './games.module.css'

const key = (kidId: number | null | undefined) => `tskfrce.games.welcome.${kidId ?? 0}`
export const welcomeSeen = (kidId: number | null | undefined) => {
  try { return localStorage.getItem(key(kidId)) === '1' } catch { return false }
}
export const markWelcomed = (kidId: number | null | undefined) => {
  try { localStorage.setItem(key(kidId), '1') } catch { /* private mode: shows again, harmless */ }
}

/** First visit to the Games tab. */
export function GamesWelcome({ celebrate, seed, onDone }: { celebrate: CelebrateLevel; seed: number; onDone: () => void }) {
  return (
    <div className={`${s.root} ${s.welcome}`} data-decor={decor(celebrate)}>
      <img className={`${s.pop} ${s.bob}`} src={mascotSrc(seed)} alt="" />
      <p>Finish chores, earn games! Each game pays a few points.</p>
      <button type="button" className={`${s.kb} ${s.sun}`} onClick={onDone}>Got it</button>
    </div>
  )
}
