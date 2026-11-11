/** Shelf Memory: Pixi rendering and animations for grid, items, and feedback. */

const GRID_COLS = 4
const CELL_SIZE = 70
const CELL_PADDING = 8
const GRID_WIDTH = GRID_COLS * (CELL_SIZE + CELL_PADDING)
const EMOJI_SIZE = 32

interface RenderState {
  items: string[]
  placed: boolean[]
  selected: number | null
  looking: boolean
  onCellTap: (i: number) => void
  onItemTap: (i: number) => void
}

export interface Renderer {
  app: any
  stage: any
  destroy: () => void
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Initialize Pixi canvas and return renderer. */
export async function initRenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  // Dynamic import of Pixi to avoid issues in tests
  const { Application, Container } = await import('pixi.js')

  const app = new Application()
  await app.init({
    canvas,
    width: GRID_WIDTH,
    height: GRID_WIDTH,
    antialias: true,
    preference: 'webgl',
  })

  // Enable touch events
  if (app.renderer.events) {
    app.renderer.events.domElement?.addEventListener('touchstart', (e) => e.preventDefault(), false)
  }

  const stage = new Container()
  app.stage.addChild(stage)

  return { app, stage, destroy: () => app.destroy() }
}

/** Render the shelf grid with items and animations. */
export async function render(renderer: Renderer, state: RenderState) {
  const { Graphics, Container, Text, Sprite } = await import('pixi.js')
  const { app, stage } = renderer
  const { items, placed, selected, looking, onCellTap } = state

  // Clear previous children
  stage.removeChildren()

  const gridContainer = new Container()
  stage.addChild(gridContainer)

  const prefersNoMotion = prefersReducedMotion()

  // Draw grid cells
  for (let i = 0; i < items.length; i++) {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    const x = col * (CELL_SIZE + CELL_PADDING)
    const y = row * (CELL_SIZE + CELL_PADDING)

    const cellGroup = new Container()
    cellGroup.x = x
    cellGroup.y = y
    gridContainer.addChild(cellGroup)

    const isDone = placed[i]
    const isSelected = selected === i && !isDone

    // Draw cell background with rounded corners effect
    const background = new Graphics()
    background.rect(0, 0, CELL_SIZE, CELL_SIZE)
    background.fill(isDone ? 0x5fff5f : 0xffffff)
    background.stroke({
      width: 2,
      color: isDone ? 0x000000 : isSelected ? 0xffaa00 : 0x000000,
    })
    cellGroup.addChild(background)

    // Selection highlight (outer border)
    if (isSelected) {
      const highlight = new Graphics()
      highlight.rect(-4, -4, CELL_SIZE + 8, CELL_SIZE + 8)
      highlight.stroke({ width: 4, color: 0xffaa00 })
      cellGroup.addChild(highlight)
    }

    // Sparkle effect for correct placements
    if (isDone && !prefersNoMotion) {
      const sparkle = new Graphics()
      sparkle.circle(CELL_SIZE * 0.25, CELL_SIZE * 0.25, 3)
      sparkle.fill(0xffff00)
      sparkle.alpha = 0.7
      cellGroup.addChild(sparkle)
    }

    // Draw emoji if visible
    if (looking || placed[i]) {
      const emoji = items[i]
      const emojiText = new Text({
        text: emoji,
        style: {
          fontSize: EMOJI_SIZE,
          fill: 0x000000,
        },
      })
      emojiText.x = CELL_SIZE / 2
      emojiText.y = CELL_SIZE / 2
      emojiText.anchor.set(0.5, 0.5)
      cellGroup.addChild(emojiText)
    }

    // Make clickable
    cellGroup.eventMode = 'static'
    cellGroup.cursor = isDone ? 'default' : 'pointer'
    cellGroup.on('pointerdown', () => {
      if (!isDone && !looking) {
        // Tap feedback animation
        if (!prefersNoMotion) {
          const originalScale = cellGroup.scale.x
          cellGroup.scale.x = 0.92
          cellGroup.scale.y = 0.92
          setTimeout(() => {
            cellGroup.scale.x = originalScale
            cellGroup.scale.y = originalScale
          }, 120)
        }
        onCellTap(i)
      }
    })
  }

  // Render the app
  app.render()
}
