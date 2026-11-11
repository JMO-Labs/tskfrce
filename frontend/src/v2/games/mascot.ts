/** Pure TS mascot animation state machine with procedural vertex deformations. */

export type MascotState = 'idle' | 'cheer' | 'wince' | 'dance'

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
  private getStateTime(): number {
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
   * Get procedural vertex deformations (for mesh warp).
   * Returns array of {x, y} offsets for each vertex (if any).
   * Simple implementation: breathing pulse on vertices.
   */
  getVertexOffsets(t: number): VertexOffset[] {
    if (this.prefersReducedMotion) return []

    // For now, return empty (vertex warp is optional).
    // A full implementation would return sine-wave deformations per vertex.
    return []
  }

  /**
   * Check if animation is in looping state.
   */
  isLooping(): boolean {
    return this.state === 'idle' || this.state === 'dance'
  }
}
