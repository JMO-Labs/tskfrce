import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import { Mascot } from '@/v2/games/Mascot'

// Mock fetch for .riv file loading
global.fetch = jest.fn()

beforeEach(() => {
  ;(global.fetch as jest.Mock).mockReset()
  // Mock matchMedia for prefers-reduced-motion
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }))
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('Mascot component', () => {
  test('renders SVG fallback when no name is provided', () => {
    render(<Mascot state="idle" mascotSvg="/mascots/cat.svg" />)
    const fallback = screen.getByTestId('mascot-fallback')
    expect(fallback).toHaveAttribute('src', '/mascots/cat.svg')
  })

  test('renders SVG fallback when .riv file fails to load', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'))

    render(<Mascot state="idle" mascotSvg="/mascots/cat.svg" name="cat-princess" />)

    await waitFor(() => {
      const svg = screen.getByTestId('mascot-svg')
      expect(svg).toHaveAttribute('src', '/mascots/cat.svg')
    })
  })

  test('applies CSS animation class for cheer state (SVG fallback)', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'))

    const { rerender } = render(<Mascot state="idle" mascotSvg="/mascots/cat.svg" name="cat-princess" />)

    await waitFor(() => {
      expect(screen.getByTestId('mascot-svg')).toBeInTheDocument()
    })

    rerender(<Mascot state="cheer" mascotSvg="/mascots/cat.svg" name="cat-princess" />)

    const svg = screen.getByTestId('mascot-svg')
    expect(svg.className).toContain('cheerAnimation')
  })

  test('applies CSS animation class for wince state (SVG fallback)', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'))

    const { rerender } = render(<Mascot state="idle" mascotSvg="/mascots/cat.svg" name="cat-princess" />)

    await waitFor(() => {
      expect(screen.getByTestId('mascot-svg')).toBeInTheDocument()
    })

    rerender(<Mascot state="wince" mascotSvg="/mascots/cat.svg" name="cat-princess" />)

    const svg = screen.getByTestId('mascot-svg')
    expect(svg.className).toContain('winceAnimation')
  })

  test('applies CSS animation class for dance state (SVG fallback)', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'))

    const { rerender } = render(<Mascot state="idle" mascotSvg="/mascots/cat.svg" name="cat-princess" />)

    await waitFor(() => {
      expect(screen.getByTestId('mascot-svg')).toBeInTheDocument()
    })

    rerender(<Mascot state="dance" mascotSvg="/mascots/cat.svg" name="cat-princess" />)

    const svg = screen.getByTestId('mascot-svg')
    expect(svg.className).toContain('danceAnimation')
  })

  test('respects prefers-reduced-motion and skips animations', () => {
    window.matchMedia = jest.fn().mockImplementation(query => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))

    render(<Mascot state="dance" mascotSvg="/mascots/cat.svg" name="cat-princess" />)

    const svg = screen.getByTestId('mascot-svg')
    // Should not have animation class when reduced motion is preferred
    expect(svg.className).not.toContain('danceAnimation')
  })

  test('applies custom className to root element', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'))

    render(<Mascot state="idle" mascotSvg="/mascots/cat.svg" name="cat-princess" className="custom-class" />)

    await waitFor(() => {
      expect(screen.getByTestId('mascot-svg')).toBeInTheDocument()
    })

    const root = screen.getByTestId('mascot-svg').parentElement
    expect(root?.className).toContain('custom-class')
  })
})
