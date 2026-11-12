import { expect, test } from '@jest/globals'
import { fireEvent, render } from '@testing-library/react'
import { zip } from '@/v2/games/quick/Zip'
import { seeded } from '@/v2/games/rng'

// jsdom has no PointerEvent: MouseEvent carries the coordinates
if (!window.PointerEvent) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent

const mount = (level: number) => {
  const onDone = jest.fn()
  render(<zip.Component level={level} rng={seeded(42)} onDone={onDone} />)
  return onDone
}
const key = (k: string) => fireEvent.keyDown(window, { key: k })

test('level 3 needs two ups; clears once', () => {
  const onDone = mount(3)
  key('ArrowUp')
  expect(onDone).not.toHaveBeenCalled()
  key('ArrowUp')
  key('ArrowUp')
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('pointer swipe up counts', () => {
  const onDone = mount(1)
  const stage = document.querySelector('[data-testid="zip"]')!
  fireEvent.pointerDown(stage, { clientX: 100, clientY: 300 })
  fireEvent.pointerUp(stage, { clientX: 102, clientY: 200 })
  expect(onDone).toHaveBeenCalledWith(true)
})

test('down or sideways fails once', () => {
  const onDone = mount(1)
  key('ArrowDown')
  key('ArrowUp')
  key('ArrowLeft')
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
