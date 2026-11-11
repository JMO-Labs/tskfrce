import { describe, expect, test, beforeEach } from '@jest/globals'
import { MascotAnimator, deform } from '@/v2/games/mascot'

describe('MascotAnimator', () => {
  let animator: MascotAnimator
  beforeEach(() => {
    animator = new MascotAnimator()
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: false, media: '', onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    }))
  })

  describe('idle state', () => {
    test('breathes smoothly 0.95-1.05', () => {
      animator.update(0, 'idle')
      for (let i = 0; i < 8; i++) {
        animator.update(0.5, 'idle')
        const s = animator.getScale()
        expect(s).toBeGreaterThanOrEqual(0.94)
        expect(s).toBeLessThanOrEqual(1.06)
      }
    })
    test('no transforms in idle', () => {
      animator.update(0, 'idle')
      animator.update(1, 'idle')
      expect(animator.getOpacity()).toBe(1)
      expect(animator.getRotation()).toBe(0)
    })
  })

  describe('cheer state', () => {
    test('hops and wiggles', () => {
      animator.update(0, 'cheer')
      let maxS = 1, minS = 1, sawRot = false
      for (let i = 0; i < 25; i++) {
        animator.update(0.02, 'cheer')
        const s = animator.getScale()
        maxS = Math.max(maxS, s); minS = Math.min(minS, s)
        if (Math.abs(animator.getRotation()) > 0.01) sawRot = true
      }
      expect(maxS).toBeGreaterThanOrEqual(1.08)
      expect(minS).toBeLessThanOrEqual(0.97)
      expect(sawRot).toBe(true)
    })
    test('translates Y during hop', () => {
      animator.update(0, 'cheer')
      let sawY = false
      for (let i = 0; i < 25; i++) {
        animator.update(0.02, 'cheer')
        if (animator.getYOffset() < -1) sawY = true
      }
      expect(sawY).toBe(true)
    })
  })

  describe('wince state', () => {
    test('squashes and shakes', () => {
      animator.update(0, 'wince')
      let minS = 1, sawX = false
      for (let i = 0; i < 20; i++) {
        animator.update(0.02, 'wince')
        minS = Math.min(minS, animator.getScale())
        if (Math.abs(animator.getXOffset()) > 0.1) sawX = true
      }
      expect(minS).toBeLessThanOrEqual(0.87)
      expect(sawX).toBe(true)
    })
    test('droops and fades', () => {
      animator.update(0, 'wince')
      for (let i = 0; i < 25; i++) animator.update(0.02, 'wince')
      expect(animator.getYOffset()).toBe(5)
      const op = animator.getOpacity()
      expect(op).toBeGreaterThan(0.5)
      expect(op).toBeLessThan(1)
    })
  })

  describe('dance state', () => {
    test('bounces and sways', () => {
      animator.update(0, 'dance')
      const scales: number[] = []
      let sawRot = false
      for (let i = 0; i < 40; i++) {
        animator.update(0.02, 'dance')
        scales.push(animator.getScale())
        if (Math.abs(animator.getRotation()) > 0.05) sawRot = true
      }
      const range = Math.max(...scales) - Math.min(...scales)
      expect(range).toBeGreaterThan(0.05)
      expect(sawRot).toBe(true)
    })
    test('bobs vertically', () => {
      animator.update(0, 'dance')
      let sawY = false
      for (let i = 0; i < 40; i++) {
        animator.update(0.02, 'dance')
        if (animator.getYOffset() < -5) sawY = true
      }
      expect(sawY).toBe(true)
    })
  })

  describe('state transitions', () => {
    test('transitions instantly', () => {
      animator.update(0, 'idle')
      animator.update(1, 'idle')
      animator.update(0, 'cheer')
      animator.update(0.01, 'cheer')
      const s = animator.getScale()
      expect(s).toBeGreaterThanOrEqual(1)
    })
  })

  describe('reduced motion', () => {
    test('disables animations', () => {
      window.matchMedia = jest.fn().mockImplementation(q => ({
        matches: q === '(prefers-reduced-motion: reduce)',
        media: q, onchange: null,
        addListener: jest.fn(), removeListener: jest.fn(),
        addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
      }))
      const r = new MascotAnimator()
      r.update(0, 'dance')
      r.update(1, 'dance')
      expect(r.getScale()).toBe(1)
      expect(r.getRotation()).toBe(0)
      expect(r.getYOffset()).toBe(0)
      expect(r.getXOffset()).toBe(0)
      expect(r.getOpacity()).toBe(1)
    })
  })

  describe('return values', () => {
    test('valid numbers & looping states', () => {
      animator.update(0, 'dance'); animator.update(0.5, 'dance')
      ;[animator.getScale(), animator.getRotation(), animator.getOpacity(),
        animator.getYOffset(), animator.getXOffset()].forEach(v => {
        expect(typeof v).toBe('number'); expect(isFinite(v)).toBe(true)
      })
      expect(Array.isArray(animator.getVertexOffsets(0.5))).toBe(true)
      animator.update(0, 'idle'); expect(animator.isLooping()).toBe(true)
      animator.update(0, 'cheer'); expect(animator.isLooping()).toBe(false)
    })
  })
})

describe('deform function', () => {
  test('feet planted at v=1 (no offset at bottom)', () => {
    const states: Array<'idle' | 'cheer' | 'wince' | 'dance'> = ['idle', 'cheer', 'wince', 'dance']
    for (const state of states) {
      for (let u = 0; u <= 1; u += 0.5) {
        const [dx, dy] = deform(state, u, 1, 0.5, 1.0, false)
        expect(Math.abs(dx)).toBeLessThan(0.001)
        expect(Math.abs(dy)).toBeLessThan(0.001)
      }
    }
  })

  test('deterministic: same inputs produce same output', () => {
    const inputs = [
      ['idle', 0.3, 0.5, 0.2, 1.0] as const,
      ['cheer', 0.7, 0.8, 0.15, 1.2] as const,
      ['wince', 0.5, 0.6, 0.1, 0.9] as const,
      ['dance', 0.4, 0.75, 0.3, 1.1] as const,
    ]
    for (const [m, u, v, t, S] of inputs) {
      const result1 = deform(m, u, v, t, S, false)
      const result2 = deform(m, u, v, t, S, false)
      expect(result1[0]).toBe(result2[0])
      expect(result1[1]).toBe(result2[1])
    }
  })

  test('returns zero displacement under reduced motion', () => {
    const states: Array<'idle' | 'cheer' | 'wince' | 'dance'> = ['idle', 'cheer', 'wince', 'dance']
    for (const state of states) {
      const [dx, dy] = deform(state, 0.5, 0.5, 1.0, 1.0, true)
      expect(dx).toBe(0)
      expect(dy).toBe(0)
    }
  })

  test('produces finite numbers for all states', () => {
    const states: Array<'idle' | 'cheer' | 'wince' | 'dance'> = ['idle', 'cheer', 'wince', 'dance']
    for (const state of states) {
      for (let t = 0; t < 2; t += 0.1) {
        const [dx, dy] = deform(state, 0.5, 0.5, t, 1.0, false)
        expect(isFinite(dx)).toBe(true)
        expect(isFinite(dy)).toBe(true)
      }
    }
  })

  test('varies displacement with vertical position', () => {
    const v0 = deform('idle', 0.5, 0, 0.5, 1.0, false)
    const v1 = deform('idle', 0.5, 1, 0.5, 1.0, false)
    // v=0 (head) should have displacement, v=1 (feet) should not
    expect(Math.abs(v0[1])).toBeGreaterThan(0.001)
    expect(Math.abs(v1[1])).toBeLessThan(0.001)
  })
})
