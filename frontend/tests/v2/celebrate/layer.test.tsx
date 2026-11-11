import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { CelebrationLayer } from '@/v2/kid/celebrate/CelebrationLayer'
import { useCelebrate, type CelebrateOpts } from '@/v2/kid/celebrate/useCelebrate'
import { seeded } from '@/v2/kid/celebrate/pick'
import type { CelebrateEvent } from '@/v2/kid/celebrate/plan'

let reduced = false
beforeEach(() => {
  reduced = false
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce') ? reduced : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia
})
afterEach(() => jest.useRealTimers())

const ev: CelebrateEvent = { kind: 'submit', key: 's:1', title: 'Dishes', points: 20, runId: 1 }

function Harness({ opts, event = ev, tile = true }: { opts: Partial<CelebrateOpts>; event?: CelebrateEvent; tile?: boolean }) {
  const cel = useCelebrate({ level: 'full', mode: 'kid', kidLevel: 1, rng: seeded(2), ...opts })
  const { fire } = cel
  useEffect(() => fire(event), [fire, event])
  return (
    <>
      <button type="button">Other</button>
      {tile && <div data-celebrate-id="1">Dishes</div>}
      <CelebrationLayer cel={cel} balance={100} />
    </>
  )
}
const layer = () => document.querySelector('[data-celebrate]')

describe('CelebrationLayer', () => {
  const tileEl = () => document.querySelector('[data-celebrate-id="1"]')

  test('full animates the real tile in place, with the +N tag; the chore shows once', () => {
    render(<Harness opts={{}} />)
    expect(layer()).toHaveAttribute('data-celebrate', 'full')
    expect(tileEl()).toHaveAttribute('data-cel-fx')
    expect(screen.getByText('+20')).toBeInTheDocument()
    expect(screen.getAllByText('Dishes')).toHaveLength(1)
  })

  test('no tile on screen: word (and mascot) only, no card effect', () => {
    render(<Harness opts={{}} tile={false} />)
    expect(layer()).toHaveAttribute('data-celebrate', 'full')
    expect(document.querySelector('[data-word]')).not.toBeNull()
    expect(document.querySelector('[data-tile-fx]')).toBeNull()
    expect(screen.queryByText('+20')).toBeNull()
  })

  test('the tile is left clean when the moment ends', () => {
    render(<Harness opts={{}} />)
    fireEvent.pointerDown(document.body)
    expect(tileEl()).not.toHaveAttribute('data-cel-fx')
    expect(tileEl()!.className).toBe('')
  })

  test('small with no tile on screen falls back to the static badge', () => {
    render(<Harness opts={{ level: 'small' }} tile={false} />)
    expect(screen.getByText('+20 ✓')).toBeInTheDocument()
  })

  test('reduced motion gives a static "+N ✓" badge and no effects', () => {
    reduced = true
    render(<Harness opts={{}} />)
    expect(layer()).toHaveAttribute('data-celebrate', 'static')
    expect(screen.getByText('+20 ✓')).toBeInTheDocument()
    expect(document.querySelector('[data-fx]')).toBeNull()
  })

  test('small is the card pop and tag only: no word, mascot or full-screen effect', () => {
    render(<Harness opts={{ level: 'small' }} event={{ ...ev, big: true }} />)
    expect(layer()).toHaveAttribute('data-celebrate', 'small')
    expect(screen.getByText('+20')).toBeInTheDocument()
    expect(document.querySelector('[data-mascot]')).toBeNull()
    expect(document.querySelector('[data-word]')).toBeNull()
    expect(document.querySelector('[data-burst]')).toBeNull()
  })

  test('off shows nothing', () => {
    render(<Harness opts={{ level: 'off' }} />)
    expect(layer()).toBeNull()
  })

  test('big moments bring a mascot', () => {
    render(<Harness opts={{}} event={{ ...ev, kind: 'level', title: 'Level 3!', big: true }} />)
    expect(document.querySelector('[data-mascot]')).not.toBeNull()
  })

  test('tapping anywhere dismisses, and the tap still reaches the app', () => {
    const onClick = jest.fn()
    render(<Harness opts={{}} />)
    const other = screen.getByRole('button', { name: 'Other' })
    other.addEventListener('click', onClick)
    fireEvent.pointerDown(other)
    fireEvent.click(other)
    expect(layer()).toBeNull()
    expect(onClick).toHaveBeenCalled()
  })

  test('ends on its own within about 1.5 s', () => {
    jest.useFakeTimers()
    render(<Harness opts={{}} />)
    expect(layer()).not.toBeNull()
    act(() => {
      jest.advanceTimersByTime(1600)
    })
    expect(layer()).toBeNull()
  })

  test('holds while an award card is up, then plays', () => {
    const { rerender } = render(<Harness opts={{ hold: true }} />)
    expect(layer()).toBeNull()
    rerender(<Harness opts={{ hold: false }} />)
    expect(layer()).not.toBeNull()
  })
})
