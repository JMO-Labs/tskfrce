/** Math Dash Pixi rendering: problem, answers, animations. */
import type { Application, Container, Graphics, Text } from 'pixi.js'
import type { MathState, Q } from './logic'

export interface GameDisplay {
  app: Application
  stage: Container
  problem: Text | null
  answers: Array<{ container: Container; rect: Graphics; text: Text }>
  hearts: Text | null
  // Animation state
  correctIdx: number | null
  wrongIdx: number | null
  shake: { x: number; y: number; t: number }
}

/** Initialize Pixi rendering structures. */
export async function initGameDisplay(
  app: Application,
  stage: Container,
  w: number,
  h: number,
): Promise<GameDisplay> {
  const P = await import('pixi.js')

  // Problem text (top center)
  const problem = new P.Text({
    text: '',
    style: {
      fontSize: 48,
      fontWeight: 'bold',
      fill: '#1d2b53',
      fontFamily: 'Space Grotesk, system-ui, sans-serif',
    },
  })
  problem.anchor.set(0.5, 0)
  problem.position.set(w / 2, 40)
  stage.addChild(problem)

  // Answer containers (2 rows, 2 columns)
  const answers: GameDisplay['answers'] = []
  const ansY = [h / 2 + 40, h / 2 + 160]
  const ansX = [w / 2 - 100, w / 2 + 100]

  for (let i = 0; i < 4; i++) {
    const container = new P.Container()
    const row = Math.floor(i / 2)
    const col = i % 2
    container.position.set(ansX[col], ansY[row])

    const rect = new P.Graphics()
    rect.rect(-80, -36, 160, 72)
    rect.fill({ color: 0xffffff })
    rect.stroke({ color: 0x1d2b53, width: 2 })
    rect.interactive = true
    rect.cursor = 'pointer'
    container.addChild(rect)

    const text = new P.Text({
      text: '',
      style: {
        fontSize: 32,
        fontWeight: 'bold',
        fill: '#1d2b53',
        fontFamily: 'Space Grotesk, system-ui, sans-serif',
      },
    })
    text.anchor.set(0.5, 0.5)
    text.position.set(0, 0)
    container.addChild(text)

    stage.addChild(container)
    answers.push({ container, rect, text })
  }

  // Hearts display (if needed)
  const hearts = new P.Text({
    text: '❤️',
    style: { fontSize: 24 },
  })
  hearts.position.set(w - 40, 10)
  stage.addChild(hearts)

  return {
    app,
    stage,
    problem,
    answers,
    hearts,
    correctIdx: null,
    wrongIdx: null,
    shake: { x: 0, y: 0, t: 0 },
  }
}

/** Update display with new question. */
export function updateQuestion(
  display: GameDisplay,
  q: Q,
  hidden: number[],
) {
  if (display.problem) {
    display.problem.text = q.text
  }

  for (let i = 0; i < 4; i++) {
    const ans = display.answers[i]
    if (ans) {
      ans.text.text = String(q.choices[i])
      ans.container.visible = !hidden.includes(i)
      ans.rect.interactive = !hidden.includes(i)
      ans.rect.tint = 0xffffff
    }
  }

  display.correctIdx = null
  display.wrongIdx = null
}

/** Animate correct answer: green flash and scale up. */
export function animateCorrect(
  display: GameDisplay,
  correct: number,
) {
  display.correctIdx = correct
  const ans = display.answers[correct]
  if (ans) {
    ans.rect.tint = 0x00cc00
    const scaleUp = () => {
      ans.container.scale.set(1.2)
      setTimeout(() => {
        ans.container.scale.set(1)
      }, 150)
    }
    scaleUp()
  }
}

/** Animate wrong answer: red flash and shake. */
export function animateWrong(
  display: GameDisplay,
  wrong: number,
) {
  display.wrongIdx = wrong
  const ans = display.answers[wrong]
  if (ans) {
    ans.rect.tint = 0xff0000
    display.shake = { x: 0, y: 0, t: 100 }
  }
}

/** Update shake animation. */
export function updateShake(display: GameDisplay, delta: number = 16) {
  if (display.shake.t > 0) {
    display.shake.t -= delta
    if (display.shake.t > 0) {
      display.shake.x = (Math.random() - 0.5) * 20
      display.shake.y = (Math.random() - 0.5) * 10
      display.stage.position.set(display.shake.x, display.shake.y)
    } else {
      display.stage.position.set(0, 0)
    }
  }
}

/** Clean up Pixi resources. */
export function destroyGameDisplay(display: GameDisplay) {
  display.problem?.destroy()
  for (const ans of display.answers) {
    ans.text.destroy()
    ans.rect.destroy()
    ans.container.destroy()
  }
  display.hearts?.destroy()
}
