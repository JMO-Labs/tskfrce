'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { Application, MeshPlane, Texture, Filter } from 'pixi.js'
import { MascotAnimator, type MascotState, deform } from './mascot'
import { initPixiApp, destroyPixiApp } from './PixiApp'
import styles from './Mascot.module.css'

interface MascotProps {
  state: MascotState
  mascotName?: string
  name?: string
  mascotSvg?: string
  className?: string
}

const textureCache = new Map<string, HTMLCanvasElement>()

async function loadSVGTexture(name: string): Promise<HTMLCanvasElement | null> {
  if (textureCache.has(name)) return textureCache.get(name) || null
  try {
    const res = await fetch(`/celebrate/mascots/${name}.svg`)
    if (!res.ok) return null
    const svg = await res.text()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, 512, 512)
        URL.revokeObjectURL(url)
        textureCache.set(name, canvas)
        resolve(canvas)
      }
      img.onerror = () => (URL.revokeObjectURL(url), resolve(null))
      img.src = url
    })
  } catch (e) {
    return null
  }
}

/**
 * Mascot component: PixiJS sprite with procedural animations.
 * Falls back to CSS-SVG if Pixi unavailable or reduced motion is enabled.
 */
export const Mascot: React.FC<MascotProps> = ({ state, mascotName: pm, name, mascotSvg, className }) => {
  const mascotName = pm || name
  const svgPath = mascotSvg || (mascotName ? `/celebrate/mascots/${mascotName}.svg` : undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const animatorRef = useRef<MascotAnimator>(new MascotAnimator())
  const rafRef = useRef<number | null>(null)
  const [useFallback, setUseFallback] = useState(() => !mascotName && !!mascotSvg)
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cb = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [])

  useEffect(() => {
    if (reducedMotion || useFallback || !containerRef.current || !mascotName) return
    ;(async () => {
      try {
        const tex = await loadSVGTexture(mascotName)
        if (!tex) { setUseFallback(true); return }
        const P = await import('pixi.js')

        // Lazy import filters
        const filters = await (async () => {
          const f = await import('pixi-filters')
          return {
            OutlineFilter: f.OutlineFilter,
            GlowFilter: f.GlowFilter,
            ShockwaveFilter: f.ShockwaveFilter,
            GodrayFilter: f.GodrayFilter,
            DropShadowFilter: f.DropShadowFilter,
            ColorMatrixFilter: P.ColorMatrixFilter
          }
        })()

        containerRef.current!.innerHTML = ''
        const { app, stage } = await initPixiApp(containerRef.current!, 400, 400)
        appRef.current = app

        // Create 10x10 MeshPlane (11x11 vertices)
        const texture = P.Texture.from(tex)
        const mesh = new P.MeshPlane({ texture, verticesX: 10, verticesY: 10 })
        mesh.position.set(200, 200)
        mesh.scale.set(1.5)
        stage.addChild(mesh)

        // Initialize filters
        let outlineFilter: Filter | null = null
        let dropShadowFilter: Filter | null = null
        let glowFilter: Filter | null = null
        let shockwaveFilter: Filter | null = null
        let godrayFilter: Filter | null = null
        let colorMatrixFilter: Filter | null = null

        const initFilters = (st: MascotState, stateTime: number) => {
          const activeFilters: Filter[] = []

          // Outline: always visible (reduced motion compatible)
          if (!outlineFilter) {
            outlineFilter = new filters.OutlineFilter({ color: 0xffffff, thickness: 3, quality: 1 })
          }
          if (outlineFilter) activeFilters.push(outlineFilter)

          // DropShadow: always visible (reduced motion compatible)
          if (!dropShadowFilter) {
            dropShadowFilter = new filters.DropShadowFilter({ blur: 2, offset: { x: 3, y: 3 }, alpha: 0.3 })
          }
          if (dropShadowFilter) activeFilters.push(dropShadowFilter)

          if (!reducedMotion) {
            // Color matrix for red flash (wince)
            if (st === 'wince') {
              if (!colorMatrixFilter) {
                colorMatrixFilter = new filters.ColorMatrixFilter()
              }
              if (colorMatrixFilter) {
                const winceIntensity = Math.max(0, 1 - stateTime / 0.4)
                const cm = colorMatrixFilter as any
                cm.hue(-0.3 * winceIntensity)
                activeFilters.push(colorMatrixFilter)
              }
            }

            // Glow on cheer/dance
            if (st === 'cheer' || st === 'dance') {
              if (!glowFilter) {
                glowFilter = new filters.GlowFilter({ distance: 8, outerStrength: 1, color: 0xffff00 })
              }
              if (glowFilter) activeFilters.push(glowFilter)
            }

            // Shockwave on cheer
            if (st === 'cheer') {
              if (!shockwaveFilter) {
                shockwaveFilter = new filters.ShockwaveFilter(
                  { x: 200, y: 200 },
                  { amplitude: 8, wavelength: 60, speed: 500 }
                )
              }
              if (shockwaveFilter) activeFilters.push(shockwaveFilter)
            }

            // Godray on dance
            if (st === 'dance') {
              if (!godrayFilter) {
                godrayFilter = new filters.GodrayFilter({ angle: 30, gain: 0.5, lacunarity: 2.5, time: 0 })
              }
              if (godrayFilter) activeFilters.push(godrayFilter)
            }
          }

          mesh.filters = activeFilters
        }

        const anim = animatorRef.current
        const dt = 0.016
        let accum = 0

        const loop = () => {
          anim.update(dt, state)
          accum += dt
          const stateTime = anim.getStateTime()

          // Update filters based on state
          initFilters(state, stateTime)

          // Update shockwave and godray time
          if (shockwaveFilter && (shockwaveFilter as any).time !== undefined) {
            (shockwaveFilter as any).time = accum
          }
          if (godrayFilter && (godrayFilter as any).time !== undefined) {
            (godrayFilter as any).time = accum
          }

          // Update mesh vertices using deform function
          const vertices = mesh.geometry.getBuffer('aVertexPosition').data as Float32Array
          const gridW = 11, gridH = 11
          const baseWidth = 256, baseHeight = 256
          const S = 120 // scale factor for deform

          for (let row = 0; row < gridH; row++) {
            for (let col = 0; col < gridW; col++) {
              const idx = (row * gridW + col) * 2
              const u = col / (gridW - 1)
              const v = row / (gridH - 1)
              const stateTime = anim.getStateTime()

              const [dx, dy] = deform(state, u, v, stateTime, S, reducedMotion)

              const baseX = (u - 0.5) * baseWidth
              const baseY = (v - 0.5) * baseHeight

              vertices[idx] = baseX + dx
              vertices[idx + 1] = baseY + dy
            }
          }
          mesh.geometry.getBuffer('aVertexPosition').update()

          // Update base transforms
          mesh.scale.set(1.5 * anim.getScale())
          mesh.rotation = anim.getRotation()
          mesh.position.set(200 + anim.getXOffset(), 200 + anim.getYOffset())
          mesh.alpha = anim.getOpacity()

          rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
      } catch (e) {
        console.error('Failed to initialize Mascot:', e)
        setUseFallback(true)
      }
    })()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (appRef.current) { destroyPixiApp(appRef.current); appRef.current = null }
    }
  }, [mascotName, state, useFallback, reducedMotion])

  useEffect(() => {
    animatorRef.current.update(0, state)
  }, [state])

  const getAnimClass = () => {
    if (reducedMotion) return ''
    const map = { cheer: styles.cheerAnimation, wince: styles.winceAnimation, dance: styles.danceAnimation }
    return map[state as keyof typeof map] || ''
  }

  if (reducedMotion || useFallback) {
    return <img src={svgPath || '/celebrate/mascots/cat-princess.svg'} alt={`${mascotName || 'mascot'}`}
      className={`${styles.svgMascot} ${getAnimClass()}`} data-testid="mascot-fallback"
      style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
  }

  return <div className={[styles.root, className].filter(Boolean).join(' ')} ref={containerRef} data-testid="mascot-pixi" />
}

export type { MascotState }
export default Mascot
