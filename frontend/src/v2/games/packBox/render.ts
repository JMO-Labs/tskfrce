/**
 * Canvas rendering and interaction helpers for Pack the Box.
 * Collision detection, placement feedback, animations.
 */
import type { Game, Piece } from './logic'
import { shapeOf } from './logic'

export interface RenderState {
  cellSize: number
  padding: number
}

export function initRenderer(canvas: HTMLCanvasElement, w: number, h: number): RenderState {
  const cellSize = Math.min(64, Math.max(44, (canvas.clientWidth - 64) / w))
  const padding = 8
  return { cellSize, padding }
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
