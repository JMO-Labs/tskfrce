import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import { Mascot } from '@/v2/games/Mascot'

// Pixi needs WebGL, which jsdom lacks: the component must fall back to the static drawing.
jest.mock('pixi.js', () => { throw new Error('no webgl in jsdom') })
jest.mock('pixi-filters', () => ({}))

const motion = (reduce: boolean) => {
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: reduce, media: query, onchange: null,
    addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia
}

describe('Mascot', () => {
  beforeEach(() => motion(false))

  test('reduced motion shows the static drawing, no canvas', () => {
    motion(true)
    render(<Mascot state="cheer" mascotName="axolotl" />)
    const img = screen.getByTestId('mascot-fallback')
    expect(img).toHaveAttribute('src', '/celebrate/mascots/axolotl.svg')
    expect(screen.queryByTestId('mascot-pixi')).toBeNull()
  })

  test('starts as a Pixi host when motion is allowed', () => {
    render(<Mascot state="idle" mascotName="trex" />)
    expect(screen.getByTestId('mascot-pixi')).toBeInTheDocument()
  })

  test('falls back to the drawing when Pixi cannot start', async () => {
    render(<Mascot state="dance" mascotName="trex" />)
    await waitFor(() => expect(screen.getByTestId('mascot-fallback')).toHaveAttribute('src', '/celebrate/mascots/trex.svg'))
  })

  test('an explicit svg path wins over the name', () => {
    motion(true)
    render(<Mascot state="idle" mascotSvg="/x/cat.svg" />)
    expect(screen.getByTestId('mascot-fallback')).toHaveAttribute('src', '/x/cat.svg')
  })
})
