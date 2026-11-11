/** Hungry Cat: PixiJS game with Fluent 3D art. */
import { useEffect, useRef, useState } from 'react'
import { seeded } from '../rng'
import { PowerSlots } from '../PowerSlots'
import type { PowerUp } from '../types'
import { initCat, stepCat } from './logic'
import { destroyPixiApp, initPixiApp } from '../PixiApp'
import { burst, loadAssets, mkCat, mkFood, updateFx, applyShake, type Assets, type SpriteItem } from './render'
import { Mascot, type MascotState } from '../Mascot'
import s from './HungryCat.module.css'

const clamp = (n: number) => Math.min(1, Math.max(0, n))

interface Props {
  level: number
  seed: number
  onEnd: (score: number) => void
  upgrades?: string[]
  powerUp?: string | null
  held?: PowerUp[]
}

export function HungryCat({ level, seed, onEnd, upgrades = [], powerUp = null, held = [] }: Props) {
  const [rng] = useState(() => seeded(seed))
  const [st, setSt] = useState(() => initCat(level, rng, { upgrades, powerUp }))
  const [mascotState, setMascotState] = useState<MascotState>('idle')
  const mascotReactRef = useRef<NodeJS.Timeout | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const catX = useRef(0.5)
  const endCb = useRef(onEnd)
  useEffect(() => {
    endCb.current = onEnd
  })

  const appRef = useRef<any>(null)
  const worldRef = useRef<any>(null)
  const assetsRef = useRef<Assets | null>(null)
  const pixiRef = useRef<any>(null)
  const spritesRef = useRef<Map<number, any>>(new Map())
  const catsRef = useRef<any[]>([])
  const fxRef = useRef<SpriteItem[]>([])
  const shakeRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const endedRef = useRef(false)
  const stillRef = useRef(matchMedia('(prefers-reduced-motion:reduce)').matches)

  // init Pixi and game
  useEffect(() => {
    let mounted = true
    const setup = async () => {
      if (!stageRef.current) return
      const { app, stage } = await initPixiApp(
        stageRef.current,
        stageRef.current.clientWidth,
        stageRef.current.clientHeight,
      )
      if (!mounted) {
        destroyPixiApp(app)
        return
      }

      appRef.current = app
      const P = await import('pixi.js')
      pixiRef.current = P

      const world = new P.Container()
      stage.addChild(world)
      worldRef.current = world

      // ground
      const W = stageRef.current.clientWidth
      const H = stageRef.current.clientHeight
      world.addChild(
        new P.Graphics()
          .rect(0, H - 46, W, 46)
          .fill(0x8fd16a)
          .rect(0, H - 46, W, 6)
          .fill(0x6bb84d),
      )

      const assets = await loadAssets()
      assetsRef.current = assets

      // init first cat
      const cat = mkCat(P, W / 2, H - 40, assets, world)
      catsRef.current = [{ ...cat, x: W / 2 }]

      // game loop with requestAnimationFrame (works with Jest fake timers)
      let last = Date.now()
      let cur = st

      const tick = () => {
        const now = Date.now()
        const dt = Math.min(50, now - last) / 1000
        last = now

        cur = stepCat(cur, dt * 1000, catX.current, level, rng)
        setSt(cur)

        // add second cat when multiply is active
        if (cur.multiply && catsRef.current.length === 1) {
          const cat2 = mkCat(P, W - catsRef.current[0].x, H - 40, assets, world)
          cat2.x = W - catsRef.current[0].x
          catsRef.current.push(cat2)
        }

        // update cat positions
        catsRef.current.forEach((c, i) => {
          const goal = Math.max(40, Math.min(W - 40, i ? W - catX.current : catX.current))
          c.x += (goal - c.x) * 0.25 * dt
          c.container.x = c.x
          c.body.scale.y += (c.body.scale.x - c.body.scale.y) * 0.2 * dt
        })

        // spawn items
        const items = cur.items
        const sprites = spritesRef.current

        // remove old sprites not in items
        for (const [id, sprite] of sprites) {
          if (!items.find((it) => it.id === id)) {
            world.removeChild(sprite)
            sprites.delete(id)
          }
        }

        // add/update sprites
        for (const it of items) {
          let sprite = sprites.get(it.id)
          if (!sprite) {
            const kind =
              it.kind === 'food'
                ? it.emoji === '🐟'
                  ? 'fish'
                  : it.emoji === '🍗'
                    ? 'fried_shrimp'
                    : 'cookie'
                : 'socks'
            sprite = mkFood(P, W * it.x, H * it.y, kind, assets, world)
            sprites.set(it.id, sprite)
          }
          sprite.x = W * it.x
          sprite.y = H * it.y
        }

        // handle catches
        for (const it of items) {
          const sprite = sprites.get(it.id)
          if (sprite) {
            const catchY = H - 60
            const hitDist = catsRef.current.some(
              (c) =>
                Math.abs(sprite.x - (c.x + 34)) < 40 && Math.abs(sprite.y - catchY) < 22,
            )
            if (hitDist && cur.items.includes(it)) {
              if (it.kind === 'food') {
                burst(P, sprite.x, sprite.y, '+1', 0x5cc46f, world, assets, stillRef.current, fxRef.current)
                catsRef.current[0].body.scale.y = catsRef.current[0].body.scale.x * 0.75
                setMascotState('cheer')
                if (mascotReactRef.current) clearTimeout(mascotReactRef.current)
                mascotReactRef.current = setTimeout(() => setMascotState('idle'), 900)
              } else {
                burst(P, sprite.x, sprite.y, '-2', 0xff6b4a, world, assets, stillRef.current, fxRef.current)
                if (!stillRef.current) shakeRef.current = 14
                setMascotState('wince')
                if (mascotReactRef.current) clearTimeout(mascotReactRef.current)
                mascotReactRef.current = setTimeout(() => setMascotState('idle'), 600)
              }
              world.removeChild(sprite)
              sprites.delete(it.id)
            }
          }
        }

        // update FX
        updateFx(fxRef.current, world, dt)

        // shake
        applyShake(world, shakeRef.current)
        if (shakeRef.current > 0) shakeRef.current -= dt
        else world.x = world.y = 0

        if (cur.over) {
          if (!endedRef.current) {
            endedRef.current = true
            setMascotState('dance')
            endCb.current(cur.score)
          }
        } else {
          rafRef.current = requestAnimationFrame(tick)
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    setup()

    return () => {
      mounted = false
      if (mascotReactRef.current) clearTimeout(mascotReactRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (appRef.current) {
        appRef.current.ticker.stop()
        destroyPixiApp(appRef.current)
        appRef.current = null
      }
    }
  }, [level])

  // keyboard input
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') catX.current = clamp(catX.current - 0.08)
      else if (e.key === 'ArrowRight') catX.current = clamp(catX.current + 0.08)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // pointer input
  const point = (e: React.PointerEvent) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (r && r.width > 0) catX.current = clamp((e.clientX - r.left) / r.width)
  }

  const clock = (ms: number, dur: number) => {
    const sec = Math.ceil(Math.max(0, dur - ms) / 1000)
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  }

  return (
    <div>
      <div className={s.hud}>
        <span>🍽️ {st.score}</span>
        <Mascot state={mascotState} mascotName="cat-princess" />
        <span aria-label={`${st.hearts} hearts`} role="img">
          {'❤️'.repeat(Math.max(0, st.hearts))}
          {'🖤'.repeat(3 - Math.max(0, st.hearts))}
        </span>
        <span>⏱ {clock(st.t, st.dur)}</span>
      </div>
      <div
        ref={stageRef}
        className={s.field}
        onPointerDown={(e) => {
          point(e)
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (e.buttons || e.pointerType === 'touch') point(e)
        }}
        data-testid="cat"
      />
      <PowerSlots held={held} armed={powerUp} />
    </div>
  )
}
