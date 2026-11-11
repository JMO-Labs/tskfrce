/** Canvas rendering component for Pack the Box game */
import { useEffect, useRef } from 'react'
import type { Game } from './logic'
import { getGridPosition, initRenderer } from './render'
import s from './PackBox.module.css'

const hue = (id: number) => (id * 67 + 20) % 360

interface CanvasProps {
  game: Game
  selected: number | null
  disabled: boolean
  onPlacePiece: (pieceId: number, row: number, col: number) => void
  onSelectPiece: (id: number) => void
  onLiftPiece: (id: number) => void
  onRotate: () => void
}

export function PixiCanvas({
  game,
  selected,
  disabled,
  onPlacePiece,
  onLiftPiece,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const width = Math.min(400, canvas.clientWidth)
    const height = Math.min(400, canvas.clientHeight)

    canvas.width = width
    canvas.height = height

    // Use basic canvas 2D for simplicity
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const state = initRenderer(canvas, game.w, game.h)
    const cellSize = state.cellSize
    const padding = state.padding

    const drawGame = () => {
      // Clear canvas
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)

      // Draw box background
      ctx.fillStyle = '#f5f5f5'
      ctx.strokeStyle = '#cccccc'
      ctx.lineWidth = 2
      const boxWidth = game.w * (cellSize + 4) + padding * 2
      const boxHeight = game.h * (cellSize + 4) + padding * 2
      ctx.fillRect(padding, padding, boxWidth, boxHeight)
      ctx.strokeRect(padding, padding, boxWidth, boxHeight)

      // Draw cells
      for (let i = 0; i < game.cover.length; i++) {
        const r = Math.floor(i / game.w)
        const c = i % game.w
        const x = padding + c * (cellSize + 4)
        const y = padding + r * (cellSize + 4)

        if (game.cover[i] === -2) {
          // blocked cell
          ctx.fillStyle = '#e0e0e0'
          ctx.fillRect(x, y, cellSize, cellSize)
          ctx.strokeStyle = '#999999'
          ctx.lineWidth = 1
          ctx.setLineDash([3, 3])
          ctx.strokeRect(x, y, cellSize, cellSize)
          ctx.setLineDash([])
        } else if (game.cover[i] >= 0) {
          // filled cell
          const id = game.cover[i]
          ctx.fillStyle = `hsl(${hue(id)} 70% 60%)`
          ctx.fillRect(x, y, cellSize, cellSize)
          ctx.strokeStyle = '#cccccc'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, cellSize, cellSize)
        } else {
          // empty cell
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(x, y, cellSize, cellSize)
          ctx.strokeStyle = '#cccccc'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, cellSize, cellSize)
        }
      }
    }

    drawGame()

    const handlePointerDown = (e: PointerEvent) => {
      if (disabled) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const gridPos = getGridPosition(state, x, y, game)
      if (gridPos) {
        const [row, col] = gridPos
        if (selected !== null) {
          onPlacePiece(selected, row, col)
        } else {
          const cellId = row * game.w + col
          if (game.cover[cellId] >= 0) {
            onLiftPiece(game.cover[cellId])
          }
        }
      }
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [game, selected, disabled, onPlacePiece, onLiftPiece])

  const calculatedHeight = Math.min(400, Math.max(44, game.h * 70))

  return (
    <div>
      <canvas
        ref={canvasRef}
        className={s.box}
        style={{
          width: '100%',
          height: `${calculatedHeight}px`,
          border: '2px solid var(--k-line)',
          borderRadius: '20px',
          backgroundColor: 'var(--k-card)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
    </div>
  )
}
