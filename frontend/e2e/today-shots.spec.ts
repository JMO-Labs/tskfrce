import { test } from '@playwright/test'
import { loginUi } from './seed'

// Today kid-card grid at its 4 / 2 / 1 column widths, to compare with docs/mockups/today (tskfrce#38).
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'e2e-artifacts/screens'
const WIDTHS = [1280, 800, 390]

test('today grid widths', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'phone projects already shoot Today at 390')
  await loginUi(page)
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500) // let web fonts and query data settle
    await page.screenshot({ path: `${SHOTS}/${info.project.name}/today-w${width}.png`, fullPage: true })
  }
})
