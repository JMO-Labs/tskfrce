/** Pure TS mascot animation state machine with procedural vertex deformations. */

export type MascotState = 'idle' | 'cheer' | 'wince' | 'dance'

/**
 * Pure deform function: computes per-vertex offsets based on animation state.
 * Deterministic and idempotent for same inputs.
 * @param m Animation state
 * @param u Horizontal position (0=left, 1=right)
 * @param v Vertical position (0=feet, 1=head)
 * @param t Time since state change (seconds)
 * @param S Scale multiplier
 * @param prefersReducedMotion If true, return zero displacement
 * @returns [dx, dy] displacement in pixels
 */
export function deform(
  m: MascotState,
  u: number,
  v: number,
  t: number,
  S: number,
  prefersReducedMotion: boolean = false
): [number, number] {
  if (prefersReducedMotion) return [0, 0]

  const up = 1 - v // 0 at feet, 1 at head
  let dx = 0, dy = 0

  if (m === 'idle') {
    dy = -Math.sin(t * 2 * Math.PI / 3.2) * 0.035 * S * up
    dx = Math.sin(t * 2 * Math.PI / 4.5) * 0.03 * S * up * up
  }

  if (m === 'cheer') {
    const p = (t % 0.9) / 0.9
    const hop = Math.sin(p * Math.PI)
    dy = -hop * 0.28 * S * up - Math.sin(p * Math.PI * 2) * 0.06 * S * up
    dx = Math.sin(t * 22) * 0.04 * S * up * up * hop
  }

  if (m === 'wince') {
    const p = Math.min(t, 0.7) / 0.7
    const k = Math.sin(p * Math.PI)
    dy = k * 0.14 * S * up
    dx = Math.sin(t * 60) * 0.025 * S * up * (1 - p) + (u - 0.5) * k * 0.12 * S * up
  }

  if (m === 'dance') {
    const b = t * 2 * Math.PI / 0.55
    dy = -Math.abs(Math.sin(b)) * 0.12 * S * up
    dx = Math.sin(b / 2) * 0.12 * S * up * up
  }

  return [dx, dy]
}

export interface VertexOffset {
  x: number
  y: number
}

/** Manages mascot animation timing and state transitions. */
export class MascotAnimator {
  private time: number = 0
  private state: MascotState = 'idle'
  private prefersReducedMotion: boolean = false
  private stateStartTime: number = 0
  private lastState: MascotState = 'idle'

  constructor() {
    // Check prefers-reduced-motion
    if (typeof window !== 'undefined') {
      this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
  }

  /**
   * Update animator with elapsed time (dt in seconds).
   * State changes reset the internal timer.
   */
  update(dt: number, newState: MascotState): void {
    if (newState !== this.state) {
      this.state = newState
      this.lastState = this.state
      this.stateStartTime = this.time
    }
    this.time += dt
  }

  /**
   * Get current animation state time (since state change).
   */
  getStateTime(): number {
    return this.time - this.stateStartTime
  }

  /**
   * Get opacity for current frame.
   */
  getOpacity(): number {
    if (this.prefersReducedMotion) return 1
    const st = this.getStateTime()

    if (this.state === 'wince') {
      // Droop: fade from 1.0 to 0.8 and back over 0.4s
      const phase = (st % 0.4) / 0.4
      if (phase < 0.5) return 1.0 - phase * 0.2
      return 0.8 + (phase - 0.5) * 0.2
    }
    return 1
  }

  /**
   * Get scale (uniform) for current frame.
   */
  getScale(): number {
    if (this.prefersReducedMotion) return 1

    const st = this.getStateTime()

    switch (this.state) {
      case 'idle': {
        // Breathing: gentle squash 0.95-1.05 over 4s
        const phase = (st % 4) / 4
        return 1 + Math.sin(phase * Math.PI * 2) * 0.05
      }
      case 'cheer': {
        // Hop: 1.0 -> 1.1 -> 0.95 over 0.5s, loop
        const cycleTime = 0.5
        const phase = (st % cycleTime) / cycleTime
        if (phase < 0.5) {
          // Jump up: 1.0 -> 1.1
          return 1.0 + phase * 0.2
        } else {
          // Land down: 1.1 -> 0.95
          const downPhase = (phase - 0.5) * 2
          return 1.1 - downPhase * 0.15
        }
      }
      case 'wince': {
        // Squash: 1.0 -> 0.85 -> 1.0 over 0.4s, once
        if (st > 0.4) return 1.0
        const phase = st / 0.4
        if (phase < 0.5) {
          // Squash down: 1.0 -> 0.85
          return 1.0 - phase * 2 * 0.15
        } else {
          // Recover: 0.85 -> 1.0
          const recoverPhase = (phase - 0.5) * 2
          return 0.85 + recoverPhase * 0.15
        }
      }
      case 'dance': {
        // Bounce: oscillate scale with 0.8s cycle
        const phase = (st % 0.8) / 0.8
        return 1 + Math.sin(phase * Math.PI * 2) * 0.1
      }
      default:
        return 1
    }
  }

  /**
   * Get rotation (radians) for current frame.
   */
  getRotation(): number {
    if (this.prefersReducedMotion) return 0

    const st = this.getStateTime()

    switch (this.state) {
      case 'cheer': {
        // Happy wiggle: ±5° over 0.3s, looped within cheer
        const cycleTime = 0.3
        const phase = (st % cycleTime) / cycleTime
        return Math.sin(phase * Math.PI * 2) * (5 * (Math.PI / 180))
      }
      case 'dance': {
        // Sway: ±8° over 0.8s
        const phase = (st % 0.8) / 0.8
        return Math.sin(phase * Math.PI * 2) * (8 * (Math.PI / 180))
      }
      default:
        return 0
    }
  }

  /**
   * Get Y translation (offset) in pixels.
   */
  getYOffset(): number {
    if (this.prefersReducedMotion) return 0

    const st = this.getStateTime()

    switch (this.state) {
      case 'cheer': {
        // Hop up/down: 0 -> -10px -> 0 over 0.5s
        const cycleTime = 0.5
        const phase = (st % cycleTime) / cycleTime
        if (phase < 0.5) {
          return -phase * 2 * 10 // up
        } else {
          return -(1 - (phase - 0.5) * 2) * 10 // down
        }
      }
      case 'wince': {
        // Droop: +5px offset after squash
        if (st > 0.4) return 5
        return 0
      }
      case 'dance': {
        // Bob: -15px to 0px, synced with bounce scale over 0.8s
        const phase = (st % 0.8) / 0.8
        return Math.sin(phase * Math.PI * 2) * -15
      }
      default:
        return 0
    }
  }

  /**
   * Get X translation (offset) in pixels (for shake).
   */
  getXOffset(): number {
    if (this.prefersReducedMotion) return 0

    const st = this.getStateTime()

    switch (this.state) {
      case 'wince': {
        // Quick shake: ±2px over first 0.2s
        if (st > 0.2) return 0
        const phase = (st / 0.2) * Math.PI * 2
        return Math.sin(phase) * 2
      }
      default:
        return 0
    }
  }

  /**
   * Get procedural vertex deformations (for MeshPlane grid deformation).
   * Returns array of {x, y} offsets indexed by row-major grid position.
   * Grid is 4x4 (16 vertices) laid out left-to-right, top-to-bottom.
   * For now, returns empty for reduced motion or when not wired to mesh.
   */
  getVertexOffsets(gridW: number = 4, gridH: number = 4): VertexOffset[] {
    if (this.prefersReducedMotion) return Array(gridW * gridH).fill({ x: 0, y: 0 })

    const st = this.getStateTime()
    const offsets: VertexOffset[] = []

    switch (this.state) {
      case 'idle': {
        // Breathing: vertical squash wave through vertices (top to bottom)
        const breathPeriod = 4
        const phase = (st % breathPeriod) / breathPeriod
        const breathWave = Math.sin(phase * Math.PI * 2) * 0.08
        for (let row = 0; row < gridH; row++) {
          const rowRatio = row / (gridH - 1)
          const localWave = Math.sin((phase + rowRatio) * Math.PI * 2) * 0.04
          for (let col = 0; col < gridW; col++) {
            offsets.push({ x: 0, y: localWave * 20 })
          }
        }
        break
      }
      case 'cheer': {
        // Jelly wobble: ripple outward from center, synced with hop
        const cycleTime = 0.5
        const phase = (st % cycleTime) / cycleTime
        const rippleMagnitude = Math.sin(phase * Math.PI) * 0.12
        const centerRow = (gridH - 1) / 2
        const centerCol = (gridW - 1) / 2
        for (let row = 0; row < gridH; row++) {
          for (let col = 0; col < gridW; col++) {
            const dx = col - centerCol
            const dy = row - centerRow
            const dist = Math.sqrt(dx * dx + dy * dy)
            const delay = dist * 0.1
            const ripplePhase = ((phase - delay) % 1) * Math.PI
            const offset = Math.sin(ripplePhase) > 0 ? Math.sin(ripplePhase) * rippleMagnitude : 0
            offsets.push({ x: (dx / Math.max(1, dist)) * offset * 15, y: (dy / Math.max(1, dist)) * offset * 15 })
          }
        }
        break
      }
      case 'wince': {
        // Squash down with shake: top pulls in, bottom extends
        if (st > 0.4) {
          // Recovery: return to normal
          for (let i = 0; i < gridW * gridH; i++) offsets.push({ x: 0, y: 0 })
        } else {
          const phase = st / 0.4
          const squashAmount = phase < 0.5 ? phase * 2 * 0.15 : (1 - phase) * 2 * 0.15
          const shakePhase = (st / 0.2) * Math.PI * 2
          const shake = Math.sin(shakePhase) * 1.5
          for (let row = 0; row < gridH; row++) {
            const rowRatio = row / (gridH - 1)
            const compression = -squashAmount * (rowRatio - 0.5) * 40
            for (let col = 0; col < gridW; col++) {
              const colRatio = col / (gridW - 1)
              offsets.push({ x: (colRatio - 0.5) * shake, y: compression })
            }
          }
        }
        break
      }
      case 'dance': {
        // Bounce and sway: vertical oscillation + horizontal rock
        const bouncePhase = (st % 0.8) / 0.8
        const swayPhase = (st % 0.8) / 0.8
        const bounceMag = Math.sin(bouncePhase * Math.PI * 2) * 0.1
        const swayMag = Math.sin(swayPhase * Math.PI * 2) * 0.08
        for (let row = 0; row < gridH; row++) {
          const rowRatio = row / (gridH - 1)
          for (let col = 0; col < gridW; col++) {
            const colRatio = col / (gridW - 1)
            const vertOffset = bounceMag * (rowRatio - 0.5) * 25
            const horizOffset = swayMag * (colRatio - 0.5) * 20
            offsets.push({ x: horizOffset, y: vertOffset })
          }
        }
        break
      }
      default:
        return Array(gridW * gridH).fill({ x: 0, y: 0 })
    }

    return offsets
  }

  /**
   * Check if animation is in looping state.
   */
  isLooping(): boolean {
    return this.state === 'idle' || this.state === 'dance'
  }
}
