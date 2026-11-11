'use client'

import { useEffect, useRef, useState } from 'react'
import type { MascotState } from './mascot'
import { RIV_CONTRACT, SVG_FALLBACK_ANIMATIONS } from './mascot'
import s from './Mascot.module.css'

interface MascotProps {
  /** Animation state: idle, cheer, wince, or dance */
  state: MascotState
  /** Path to SVG fallback (e.g., /mascots/cat-princess.svg) */
  mascotSvg: string
  /** Optional mascot name for .riv file path */
  name?: string
  /** Optional CSS class to apply */
  className?: string
}

/**
 * Mascot animation component with Rive support and SVG fallback.
 *
 * Tries to load and mount Rive canvas from /celebrate/mascots/{name}.riv.
 * Falls back to CSS-SVG animation if .riv is unavailable.
 */
export function Mascot({ state, mascotSvg, name, className = '' }: MascotProps) {
  const [riveError, setRiveError] = useState(false)
  const [riveReady, setRiveReady] = useState(false)
  const riveRef = useRef<HTMLCanvasElement | null>(null)
  const riveInstanceRef = useRef<any>(null)

  // Respect prefers-reduced-motion
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Try to load and initialize Rive
  useEffect(() => {
    if (riveError || prefersReducedMotion) return

    const initRive = async () => {
      try {
        if (!name) throw new Error('No mascot name provided')

        const { Rive, StateMachineInput } = await import('@rive-app/canvas')

        const rivePath = `/celebrate/mascots/${name}.riv`

        // Fetch the .riv file
        const response = await fetch(rivePath, { signal: AbortSignal.timeout(5000) })
        if (!response.ok) {
          console.warn(`Failed to load .riv file: ${rivePath}`)
          setRiveError(true)
          return
        }

        const arrayBuffer = await response.arrayBuffer()
        const riveData = new Uint8Array(arrayBuffer)

        // Create Rive instance
        const rive = new Rive({
          buffer: riveData,
          canvas: riveRef.current!,
          artboard: RIV_CONTRACT.artboard,
          stateMachines: RIV_CONTRACT.stateMachine,
          autoplay: true,
          onLoad: () => {
            setRiveReady(true)
            riveInstanceRef.current = rive
          },
        })
      } catch (error) {
        console.warn('Rive initialization failed, using SVG fallback:', error)
        setRiveError(true)
      }
    }

    initRive()
  }, [name, riveError])

  // Update Rive state inputs when state changes
  useEffect(() => {
    if (!riveReady || !riveInstanceRef.current) return

    const rive = riveInstanceRef.current
    const inputs = rive.stateMachineInputs(0)
    if (!inputs) return

    // Reset all inputs
    const cheerInput = inputs.find((i: any) => i.name === 'cheer')
    const winceInput = inputs.find((i: any) => i.name === 'wince')
    const danceInput = inputs.find((i: any) => i.name === 'dance')

    if (cheerInput) cheerInput.value = state === 'cheer'
    if (winceInput) winceInput.value = state === 'wince'
    if (danceInput) danceInput.value = state === 'dance'
  }, [state, riveReady])

  // SVG fallback render
  if (riveError || prefersReducedMotion) {
    const animClass = prefersReducedMotion ? '' : SVG_FALLBACK_ANIMATIONS[state]
    return (
      <div className={`${s.root} ${className}`}>
        <img
          src={mascotSvg}
          alt="Mascot"
          className={`${s.svgMascot} ${animClass ? s[animClass] : ''}`}
          data-testid="mascot-svg"
        />
      </div>
    )
  }

  // Rive canvas render
  return (
    <div className={`${s.root} ${className}`}>
      {!name ? (
        <img src={mascotSvg} alt="Mascot" className={s.svgMascot} data-testid="mascot-fallback" />
      ) : (
        <canvas
          ref={riveRef}
          className={s.riveCanvas}
          data-testid="mascot-rive"
          style={{ opacity: riveReady ? 1 : 0 }}
        />
      )}
    </div>
  )
}
