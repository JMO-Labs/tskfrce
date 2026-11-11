'use client'
/**
 * Game host mascot as a "living sticker": one drawing bent with a Pixi MeshPlane
 * (see deform in mascot.ts) plus pixi-filters effects. Ported from the approved
 * prototype .superpowers/brainstorm/.../mascot-fx-v2.html.
 * Pixi and pixi-filters load lazily, so they only ship in game chunks.
 * Reduced motion → static SVG (no bending, flashes, rays or shockwave).
 */
import React, { useEffect, useRef, useState } from 'react'
import { type MascotState, deform } from './mascot'
import styles from './Mascot.module.css'

export const MASCOTS = ['trex', 'cat-princess', 'dog-cowboy', 'axolotl', 'sloth-cool', 'lizard-sombrero'] as const

interface MascotProps {
  state: MascotState
  mascotName?: string
  name?: string
  mascotSvg?: string
  className?: string
  /** CSS px of the square canvas */
  size?: number
}

const N = 10 // mesh grid (vertices per side)

export const Mascot: React.FC<MascotProps> = ({ state, mascotName: pm, name, mascotSvg, className, size = 72 }) => {
  const mascotName = pm || name || 'cat-princess'
  const svg = mascotSvg || `/celebrate/mascots/${mascotName}.svg`
  const box = useRef<HTMLDivElement>(null)
  const stateRef = useRef<{ s: MascotState; t0: number }>({ s: state, t0: 0 })
  const [still, setStill] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cb = (e: MediaQueryListEvent) => setStill(e.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [])

  // a new mood restarts its clock; the Pixi app is NOT rebuilt
  useEffect(() => { stateRef.current = { s: state, t0: performance.now() } }, [state])

  useEffect(() => {
    if (still || failed || !box.current) return
    let dead = false
    let cleanup = () => {}
    ;(async () => {
      try {
        const P = await import('pixi.js')
        const F = await import('pixi-filters')
        if (dead || !box.current) return
        const W = size, H = size, S = Math.round(size * 0.72)
        const app = new P.Application()
        await app.init({ width: W, height: H, backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true })
        if (dead) { app.destroy(true); return }
        box.current.appendChild(app.canvas)
        const scene = new P.Container()
        app.stage.addChild(scene)
        // dance sunburst: 12 drawn wedges spinning (no filter, cheap on old phones)
        const rays = new P.Graphics()
        for (let i = 0; i < 12; i++) {
          const a0 = (i / 12) * Math.PI * 2, a1 = a0 + Math.PI / 12, r = W * 0.75
          rays.poly([0, 0, Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r]).fill(i % 2 ? 0xffc93c : 0xffe27a)
        }
        const rayMask = new P.Graphics().circle(W / 2, H / 2, W / 2).fill(0xffffff)
        rays.x = W / 2; rays.y = H / 2; rays.mask = rayMask; rays.visible = false
        scene.addChild(rayMask, rays)
        const shadow = new P.Graphics().ellipse(0, 0, S / 3, S / 15).fill({ color: 0x1d2b53, alpha: 0.22 })
        shadow.x = W / 2; shadow.y = H - H * 0.09; scene.addChild(shadow)
        const tex = await P.Assets.load({ src: svg, data: { resolution: 2 } })
        if (dead) { app.destroy(true); return }
        const plane = new P.MeshPlane({ texture: tex, verticesX: N, verticesY: N })
        plane.width = S; plane.height = S; plane.x = (W - S) / 2; plane.y = H - S - H * 0.08
        const glow = new F.GlowFilter({ distance: 10, outerStrength: 0, color: 0xffe27a, quality: 0.2 })
        const flash = new P.ColorMatrixFilter()
        plane.filters = [new F.OutlineFilter({ thickness: 2, color: 0xffffff, quality: 0.15 }), flash, glow,
          new F.DropShadowFilter({ offset: { x: 2, y: 2 }, alpha: 0.25, blur: 1 })]
        scene.addChild(plane)
        const shock = new F.ShockwaveFilter({ center: { x: W / 2, y: H - 10 }, amplitude: 10, wavelength: 50, radius: -1, speed: 200 })
        const pos = plane.geometry.getBuffer('aPosition')
        const base = Float32Array.from(pos.data as Float32Array)
        const sx = plane.scale.x, sy = plane.scale.y
        const sparks: (InstanceType<typeof P.Graphics> & { vx: number; vy: number; life: number })[] = []
        const burst = () => {
          for (let i = 0; i < 8; i++) {
            const s = Object.assign(new P.Graphics().star(0, 0, 5, size / 30, size / 70).fill(i % 2 ? 0xffc93c : 0xffffff), { vx: 0, vy: 0, life: 40 })
            const a = Math.random() * 6.28
            s.x = W / 2; s.y = H / 2; s.vx = Math.cos(a) * 2.5; s.vy = Math.sin(a) * 2.5 - 1.5
            scene.addChild(s); sparks.push(s)
          }
        }
        let lastHop = -1
        app.ticker.add(tk => {
          const { s: m, t0 } = stateRef.current
          const t = (performance.now() - t0) / 1000, d = tk.deltaTime
          const data = pos.data as Float32Array
          for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const k = (j * N + i) * 2
            const [dx, dy] = deform(m, i / (N - 1), j / (N - 1), t, S)
            data[k] = base[k] + dx / sx; data[k + 1] = base[k + 1] + dy / sy
          }
          pos.update()
          const lift = m === 'cheer' ? Math.sin(((t % 0.9) / 0.9) * Math.PI) : m === 'dance' ? Math.abs(Math.sin(t * 2 * Math.PI / 0.55)) * 0.4 : 0
          shadow.scale.set(1 - lift * 0.45); shadow.alpha = 1 - lift * 0.5
          glow.outerStrength = m === 'cheer' ? 2.2 * lift : m === 'dance' ? 1.2 : 0
          const hop = Math.floor(t / 0.9)
          if (m === 'cheer' && hop !== lastHop) { lastHop = hop; burst(); shock.time = 0; scene.filters = [shock] }
          if (m !== 'cheer') lastHop = -1
          if (scene.filters) { shock.time += d / 60; if (shock.time > 0.6) scene.filters = null }
          flash.reset()
          if (m === 'wince') { flash.tint(0xff6b6b, false); flash.alpha = Math.max(0, 1 - (t % 1.4) / 0.5) }
          rays.visible = m === 'dance'; rays.alpha = 0.85; rays.rotation += 0.01 * d
          for (let i = sparks.length - 1; i >= 0; i--) {
            const p = sparks[i]
            p.x += p.vx * d; p.y += p.vy * d; p.vy += 0.12 * d; p.rotation += 0.2 * d; p.alpha = p.life / 40
            if ((p.life -= d) <= 0) { p.destroy(); sparks.splice(i, 1) }
          }
        })
        const vis = () => (document.hidden ? app.ticker.stop() : app.ticker.start())
        document.addEventListener('visibilitychange', vis)
        cleanup = () => {
          document.removeEventListener('visibilitychange', vis)
          app.canvas.remove()
          app.destroy(true, { children: true }) // filters + textures go with the stage
        }
      } catch {
        if (!dead) setFailed(true)
      }
    })()
    return () => { dead = true; cleanup() }
  }, [svg, size, still, failed])

  if (still || failed) {
    return <img src={svg} alt="" aria-hidden className={[styles.svgMascot, className].filter(Boolean).join(' ')}
      width={size} height={size} data-testid="mascot-fallback" />
  }
  return <div ref={box} aria-hidden className={[styles.root, className].filter(Boolean).join(' ')}
    style={{ width: size, height: size }} data-testid="mascot-pixi" />
}

export type { MascotState }
export default Mascot
