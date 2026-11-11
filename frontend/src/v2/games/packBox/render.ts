/**
 * PixiJS rendering and interaction for Pack the Box.
 * Shape rendering, collision detection, placement feedback.
 */
import { Graphics, Container, Text, Application } from 'pixi.js'
import type { Game, Piece } from './logic'
import { shapeOf } from './logic'

const hue = (id: number) => (id * 67 + 20) % 360

export interface RenderState {
  app?: Application
  stage: Container
  cellSize: number
  padding: number
  colors: Map<number, string>
}

export function initRenderer(canvas: HTMLCanvasElement, w: number, h: number): RenderState {
  const cellSize = Math.min(64, Math.max(44, (canvas.clientWidth - 64) / w))
  const padding = 8
  return {
    stage: new Container(),
    cellSize,
    padding,
    colors: new Map(),
  }
}

/** Convert RGB values to a Pixi color integer */
function hslToRgb(hsl: string): number {
  const h = parseInt(hsl.match(/\d+/)?.[0] || '0')
  const s = parseInt(hsl.match(/(\d+)%/)?.[1] || '70')
  const l = parseInt(hsl.match(/(\d+)%/g)?.[1] || '60')

  const c = ((100 - Math.abs(2 * l - 100)) / 100) * (s / 100)
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = (l / 100) - (c / 2)

  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }

  return ((Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255))
}

/** Draw the game box grid */
export function drawBox(state: RenderState, game: Game, container: Container): Container {
  const box = new Container()

  for (let i = 0; i < game.cover.length; i++) {
    const r = Math.floor(i / game.w)
    const c = i % game.w
    const x = state.padding + c * (state.cellSize + 4)
    const y = state.padding + r * (state.cellSize + 4)

    const cell = new Graphics()
    cell.lineStyle(2, 0xcccccc, 1)

    if (game.cover[i] === -2) {
      // blocked cell
      cell.lineStyle(2, 0x999999, 0.6)
      cell.moveTo(0, 0)
      cell.lineTo(state.cellSize, state.cellSize)
      cell.moveTo(state.cellSize, 0)
      cell.lineTo(0, state.cellSize)
    } else if (game.cover[i] >= 0) {
      // filled cell
      const id = game.cover[i]
      const hslColor = `hsl(${hue(id)} 70% 60%)`
      const color = hslToRgb(hslColor)
      cell.beginFill(color, 0.8)
    } else {
      cell.beginFill(0xffffff, 0.1)
    }

    cell.drawRect(0, 0, state.cellSize, state.cellSize)
    cell.position.set(x, y)
    cell.interactive = true
    cell.data = { cellIndex: i }

    box.addChild(cell)
  }

  container.addChild(box)
  return box
}

/** Draw a single piece in the tray */
export function drawPiece(state: RenderState, piece: Piece, x: number, y: number, selected: boolean, dim = false): Container {
  const shape = shapeOf(piece)
  const maxR = Math.max(...shape.map(c => c[0])) + 1
  const maxC = Math.max(...shape.map(c => c[1])) + 1

  const container = new Container()
  const miniCellSize = 22

  const hslColor = `hsl(${hue(piece.id)} 70% 60%)`
  const color = hslToRgb(hslColor)

  for (const [r, c] of shape) {
    const cell = new Graphics()
    cell.lineStyle(1.5, 0x333333, 1)
    cell.beginFill(color, dim ? 0.45 : 0.8)
    cell.drawRect(0, 0, miniCellSize, miniCellSize)
    cell.position.set(c * (miniCellSize + 2), r * (miniCellSize + 2))
    container.addChild(cell)
  }

  if (selected) {
    const bg = new Graphics()
    bg.beginFill(0xffcc00, 0.2)
    bg.drawRect(-4, -4, maxC * (miniCellSize + 2) + 8, maxR * (miniCellSize + 2) + 8)
    container.addChildAt(bg, 0)
  }

  container.position.set(x, y)
  container.interactive = true
  container.data = { pieceId: piece.id }

  return container
}

/** Animate a cell being filled */
export function animateSquash(cell: Graphics, duration = 150): Promise<void> {
  return new Promise(resolve => {
    const startScale = 1
    const startTime = Date.now()

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      // squash down then back
      const squash = Math.sin(progress * Math.PI)
      cell.scale.y = 1 - squash * 0.2
      cell.scale.x = 1 + squash * 0.1

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        cell.scale.set(1, 1)
        resolve()
      }
    }

    animate()
  })
}

/** Animate sparkles on level clear */
export function animateSparkle(container: Container, cx: number, cy: number, count = 8): Promise<void> {
  const particles: Graphics[] = []

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const speed = 2 + Math.random() * 2
    const p = new Graphics()
    p.beginFill(0xffff00, 1)
    p.drawCircle(0, 0, 2)
    p.position.set(cx, cy)

    const vx = Math.cos(angle) * speed
    const vy = Math.sin(angle) * speed
    const startTime = Date.now()
    const duration = 600

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      p.alpha = 1 - progress * progress
      p.position.x += vx
      p.position.y += vy

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        container.removeChild(p)
      }
    }

    container.addChild(p)
    particles.push(p)
    animate()
  }

  return new Promise(resolve => {
    setTimeout(resolve, 600)
  })
}

/** Check if shape can be placed at position considering the game grid */
export function canPlaceShapeOnGrid(state: RenderState, game: Game, piece: Piece, gridX: number, gridY: number): boolean {
  const shape = shapeOf(piece)

  for (const [dr, dc] of shape) {
    const r = gridY + dr
    const c = gridX + dc

    if (r < 0 || c < 0 || r >= game.h || c >= game.w) return false
    const idx = r * game.w + c
    if (game.cover[idx] !== -1) return false
  }

  return true
}

/** Get grid position from canvas coordinates */
export function getGridPosition(state: RenderState, canvasX: number, canvasY: number, game: Game): [number, number] | null {
  const relX = canvasX - state.padding
  const relY = canvasY - state.padding

  const col = Math.floor(relX / (state.cellSize + 4))
  const row = Math.floor(relY / (state.cellSize + 4))

  if (row >= 0 && row < game.h && col >= 0 && col < game.w) {
    return [row, col]
  }

  return null
}
