'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { Application } from 'pixi.js'
import { MascotAnimator, type MascotState } from './mascot'
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
 * Mascot component: PixiJS-based living sticker with procedural deformations.
 * Falls back to CSS-SVG if Pixi unavailable or reduced motion is enabled.
 */
export const Mascot: React.FC<MascotProps> = ({ state, mascotName: pm, name, mascotSvg, className }) => {
  const mascotName = pm || name
  const svgPath = mascotSvg || (mascotName ? `/celebrate/mascots/${mascotName}.svg` : undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const animatorRef = useRef<MascotAnimator>(new MascotAnimator())
  const rafRef = useRef<number | null>(null)
  const [useFallback, setUseFallback] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const cb = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [])

  useEffect(() => {
    if (!mascotName && mascotSvg) setUseFallback(true)
  }, [mascotName, mascotSvg])

  useEffect(() => {
    if (reducedMotion || useFallback || !containerRef.current || !mascotName) return
    ;(async () => {
      try {
        const tex = await loadSVGTexture(mascotName)
        if (!tex) { setUseFallback(true); return }
        const P = await import('pixi.js')
        containerRef.current!.innerHTML = ''
        const { app, stage } = await initPixiApp(containerRef.current!, 400, 400)
        appRef.current = app
        const sprite = new P.Sprite(P.Texture.from(tex))
        sprite.anchor.set(0.5)
        sprite.position.set(200, 200)
        sprite.scale.set(1.5)
        stage.addChild(sprite)
        const anim = animatorRef.current
        const loop = () => {
          anim.update(0.016, state)
          sprite.scale.set(1.5 * anim.getScale())
          sprite.rotation = anim.getRotation()
          sprite.position.set(200 + anim.getXOffset(), 200 + anim.getYOffset())
          sprite.alpha = anim.getOpacity()
          rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
      } catch (e) {
        setUseFallback(true)
      }
    })()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (appRef.current) { destroyPixiApp(appRef.current); appRef.current = null }
    }
  }, [mascotName, name, state, useFallback, reducedMotion])

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

export default Mascot
