/** PixiJS app factory with lifecycle management. */
import type { Application, Container } from 'pixi.js'

export async function initPixiApp(
  container: HTMLElement,
  w: number,
  h: number,
): Promise<{ app: Application; stage: Container }> {
  const P = await import('pixi.js')
  const dpr = Math.min(devicePixelRatio, 2)
  const app = new P.Application()
  await app.init({
    width: w,
    height: h,
    backgroundAlpha: 0,
    antialias: true,
    resolution: dpr,
    autoDensity: true,
  })
  container.appendChild(app.canvas)

  // pause on visibility change
  const handle = () => {
    if (document.hidden) app.ticker.stop()
    else app.ticker.start()
  }
  document.addEventListener('visibilitychange', handle)

  return { app, stage: app.stage }
}

export function destroyPixiApp(app: Application) {
  app.canvas.remove()
  app.destroy()
}
