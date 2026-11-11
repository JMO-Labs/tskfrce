import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useKidGoalAction, useKidGoals } from '../../hooks/useKidGoals'
import { MASCOTS } from './catalog'
import s from './goal-party.module.css'

const COLORS = ['#1d2b53', '#fff', '#5cc46f', '#26a0ff', '#ff6b4a', '#8a5cff']
const PIECES = Array.from({ length: 34 }, (_, i) => ({ left: `${(i * 37) % 100}%`, delay: `${((i * 0.77) % 2.6).toFixed(2)}s`, color: COLORS[i % COLORS.length] }))
const CAST = MASCOTS.filter((m) => m.art === 'cutout')

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Full-screen mascot party for the first unseen fulfilled goal. Tap anywhere or Escape marks it seen. */
export function GoalParty({ onExpired, celebrate, onShowing }: { onExpired: () => void; celebrate: 'off' | 'small' | 'full'; onShowing?: (showing: boolean) => void }) {
  const { data } = useKidGoals(onExpired)
  const seen = useKidGoalAction(onExpired)
  const [gone, setGone] = useState<number[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const next = data?.party?.find((p) => !gone.includes(p.goal_id))
  const id = next?.goal_id
  const still = celebrate === 'off' || reduced()

  const close = () => {
    if (id == null) return
    seen.mutate({ id, action: 'party-seen' })
    setGone((g) => [...g, id])
  }
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => onShowing?.(id != null), [id, onShowing])
  useEffect(() => {
    if (id == null) return
    ref.current?.focus()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [id])

  if (!next) return null
  return (
    <div ref={ref} className={s.party} role="dialog" aria-label="Goal complete" tabIndex={-1} onClick={close}>
      {!still && (
        <div className={s.conf} aria-hidden="true">
          {PIECES.map((p, i) => (
            <i key={i} data-confetti style={{ left: p.left, background: p.color, animationDelay: p.delay } as CSSProperties} />
          ))}
        </div>
      )}
      <h2>{`${next.name}\nis happening!`}</h2>
      <p>{next.by} made it official.</p>
      <div className={s.badge}>Goal complete</div>
      <div className={s.dance} aria-hidden="true">
        {CAST.map((m) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={m.id} src={m.src} alt="" style={still ? { animation: 'none' } : undefined} />
        ))}
      </div>
    </div>
  )
}
