import { forwardRef, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { PROPS, mascotById } from './catalog'
import type { BurstFx, CardFx, EntryFx, LegendaryFx, Spark, StyleFx, WordColor } from './pick'
import type { CelebrateEvent } from './plan'
import { fitWordSize } from './words'
import s from './celebrate.module.css'
import mc from './mascot.module.css'

type Vars = CSSProperties & Record<`--${string}`, string | number>
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

// Card shards for "explode": [x, y, rotate] in px / deg, spread round the tile.
const SHARDS: [number, number, number][] = [
  [-170, -120, -200], [-60, -170, 140], [70, -160, -120], [180, -110, 220], [-200, 10, 90], [210, 30, -160],
  [-150, 140, 260], [-30, 180, -90], [90, 170, 180], [170, 120, -240], [-90, -40, 300], [110, -30, -300],
]

/**
 * What sits over the real tile (positioned at its rect by the layer): the "+N" tag, the stamp, smoke puffs,
 * or the flash and shards when it explodes. The tile itself does the pop / wiggle / jolt / launch / burst.
 */
export const TileAnchor = forwardRef<HTMLDivElement, { event: CelebrateEvent; fx: CardFx }>(function TileAnchor({ event, fx }, ref) {
  return (
    <div ref={ref} className={s.anchor} data-tile-fx={fx}>
      {event.points != null && <span className={s.tag}>{`+${event.points}`}</span>}
      {fx === 'stamp' && <div className={s.stamp}>DONE!</div>}
      {fx === 'blast' && range(3).map((i) => <i key={i} className={s.smoke} style={{ '--i': i, '--d': `${i * 0.08}s` } as Vars} />)}
      {fx === 'explode' && (
        <>
          <i className={s.flash}>
            <b />
          </i>
          {SHARDS.map(([x, y, r], i) => (
            // the outline is a drop-shadow on the wrapper: clip-path would cut a border off
            <i key={i} className={s.shard} style={{ '--x': `${x}px`, '--y': `${y}px`, '--r': `${r}deg`, '--i': i } as Vars}>
              <b />
            </i>
          ))}
        </>
      )}
    </div>
  )
})

/** The big comic word, sized to the screen width (and re-measured in case the fallback font runs wide). */
export function Word({ text, color, base, width }: { text: string; color: WordColor; base: number; width: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const max = Math.min(width * 0.9, 900)
  const size = fitWordSize(text, max, base, 20)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !el.scrollWidth || el.scrollWidth <= max) return
    el.style.fontSize = `${Math.max(20, Math.floor((size * max) / el.scrollWidth))}px`
  }, [text, size, max])
  return (
    <div ref={ref} className={s.word} data-word data-color={color} style={{ fontSize: size }}>
      {text}
    </div>
  )
}

/** Confetti pieces falling across the screen. */
export const Confetti = ({ n = 18 }: { n?: number }) => (
  <div className={s.confetti} data-burst="confetti">
    {range(n).map((i) => (
      <i key={i} style={{ '--x': `${((i * 37) % 100) + 1}%`, '--d': `${(i % 6) * 0.04}s`, '--i': i } as Vars} />
    ))}
  </div>
)

// Sneeze spray directions.
const SPRAY: [number, number][] = [[90, -90], [140, -30], [110, -150], [170, -80], [60, -170], [190, -10], [130, -120], [80, -50]]

/** Fireworks: 3 to 5 starbursts in kid colours that pop at random points and fade. */
const Fireworks = ({ sparks }: { sparks: Spark[] }) => (
  <div className={s.col} data-burst="fireworks">
    {sparks.map(([x, y, d], i) => (
      <span key={i} className={mc.fw} data-spark style={{ left: `${x}%`, top: `${y}%`, '--d': `${d}s` } as Vars}>
        {range(12).map((r) => (
          <i key={r} style={{ '--a': `${r * 30}deg` } as Vars} />
        ))}
      </span>
    ))}
  </div>
)

/** The burst under the word: confetti, coins to the counter, balloon, disco, a confetti sneeze, or fireworks. */
export function Burst({ fx, balance, sparks = [] }: { fx: BurstFx; balance?: number; sparks?: Spark[] }) {
  if (fx === 'fireworks') return <Fireworks sparks={sparks} />
  if (fx === 'coins')
    return (
      <div data-burst="coins">
        {balance != null && <span className={s.counter}>{`★ ${balance}`}</span>}
        {range(6).map((i) => (
          <i key={i} className={s.coin} style={{ '--sx': `${(i - 2.5) * 16}px`, '--d': `${i * 0.06}s` } as Vars} />
        ))}
      </div>
    )
  if (fx === 'balloon') return <i className={s.balloon} data-burst="balloon" />
  if (fx === 'disco')
    return (
      <div data-burst="disco">
        <span className={s.col}>
          <i className={s.beams} />
        </span>
        <i className={s.ball} />
      </div>
    )
  if (fx === 'sneeze')
    return (
      <div className={s.sneezer} data-burst="sneeze">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mascotById('cat').src} alt="" />
        {SPRAY.map(([x, y], i) => (
          <i key={i} style={{ '--x': `${x}px`, '--y': `${y}px`, '--i': i } as Vars} />
        ))}
      </div>
    )
  return <Confetti />
}

/**
 * A mascot popping up with a speech bubble: centred, its image bottom kept under the screen edge (trex-tryout v5),
 * with a random look (mascot-styles-v2) and entrance (mascots-animated-v1). Peek tucks in from the corner instead.
 */
export function MascotPop({ id, say, prop, style = 'original', entry = 'rise' }: { id: string; say: string; prop?: string; style?: StyleFx; entry?: EntryFx }) {
  const m = mascotById(id)
  const held = prop ?? m.prop
  const mask = `url(${m.src})`
  return (
    <div className={mc.mascot} data-mascot={m.id} data-art={m.art} data-entry={entry}>
      <span className={mc.look} data-style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.src} alt="" className={mc.mascotImg} />
        {style === 'popart' && <span className={mc.halftone} style={{ maskImage: mask, WebkitMaskImage: mask }} />}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {held && <img src={held} alt="" className={mc.prop} />}
      <span className={mc.bubble}>{say}</span>
    </div>
  )
}

/** Legendary (about 1 in 25): a parade across the screen, or a dance party. */
export function Legendary({ fx, cast }: { fx: LegendaryFx; cast: string[] }) {
  return (
    <div className={mc.legend} data-burst={fx} data-legendary={fx}>
      <span className={s.col}>
        <i className={s.beams} />
      </span>
      {fx === 'party' && <i className={s.ball} />}
      <div className={mc.cast}>
        {cast.map((id, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={mascotById(id).src} alt="" style={{ '--i': i, '--d': `${fx === 'parade' ? i * 0.07 : (i % 2) * 0.12}s` } as Vars} />
        ))}
      </div>
      {fx === 'party' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={mc.popper} src={PROPS.popper} alt="" />
      )}
      <Confetti n={28} />
    </div>
  )
}
