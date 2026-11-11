// Declutter shot script. Usage: node shoot.mjs <outDir> <name> <appPath> [<mockupFile> <preset> [step=<n>]]
// Env CLICK = app button names to click first (| separated), MOCKCLICK = css selectors to click in the mockup (| separated); the mouse is parked afterwards. Shoots phone + desktop x light + dark of <appPath> (and the mockup's #box when given). Env PRESS (+PRESS_DOWN=1) = hover / hold a control. Env SCROLLTO = css selector scrolled into view (bottom aligned) before the shot. Env DESKTOP_H sets desktop height (default 900).
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { route, S } from './mock.mjs'
const { chromium } = createRequire(new URL('../../../frontend/package.json', import.meta.url))('playwright')
const [OUT, NAME, APP, MOCK, PRESET, STEP] = process.argv.slice(2)
const STEP_N = /^step=(\d+)$/.exec(STEP ?? '')?.[1] ?? null
if (!OUT || !NAME || !APP) { console.error('usage: shoot.mjs <outDir> <name> <appPath> [<mockupFile> <preset> [step=<n>]]'); process.exit(1) }
const BASE = 'http://127.0.0.1:3295'
const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const DESKTOP_H = Number(process.env.DESKTOP_H) || 900
mkdirSync(OUT, { recursive: true })
const misses = new Set(), errors = []
const browser = await chromium.launch()
for (const [dv, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: DESKTOP_H }]]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, isMobile: dv === 'phone', hasTouch: dv === 'phone', deviceScaleFactor: dv === 'phone' ? 2 : 1 })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`${dv}-${scheme} ${String(e).slice(0, 160)}`))
    await page.route('**/api/proxy/**', (r) => route(r, misses))
    S.setup = { needed: false }; S.step = STEP_N === null ? null : Number(STEP_N)
    try {
      if (APP !== '-') { // APP '-' = mockup only (no dev server)
      await page.goto(`${BASE}/login`, { timeout: 240000 })
      await page.getByLabel('Username', { exact: true }).fill('dad')
      await page.getByLabel('Password', { exact: true }).fill('pw12345678')
      await page.getByRole('button', { name: 'Log in' }).click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 240000 })
      await page.goto(`${BASE}${APP}`, { timeout: 240000 })
      await page.locator('main').first().waitFor({ timeout: 240000 })
      await page.waitForTimeout(1200)
      if (process.env.CLICK) { for (const n of process.env.CLICK.split('|')) { if (n === 'Escape') await page.keyboard.press('Escape'); else { await page.getByRole('button', { name: n, exact: true }).focus(); await page.keyboard.press('Enter') } await page.waitForTimeout(400) } await page.mouse.move(0, 0); await page.waitForTimeout(300) }
      if (process.env.SCROLLTO) { await page.locator(process.env.SCROLLTO).last().evaluate((e) => e.scrollIntoView({ block: 'end' })); await page.waitForTimeout(400) }
      if (process.env.PRESS) { const b = await page.locator(process.env.PRESS).first().boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); if (process.env.PRESS_DOWN) await page.mouse.down(); await page.waitForTimeout(300) } // PRESS = css selector: park the mouse on it (and hold the button down with PRESS_DOWN=1)
      await page.screenshot({ path: `${OUT}/${NAME}-${dv}-${scheme}.png` })
      console.log('shot', NAME, dv, scheme)
      }
      if (MOCK && PRESET) {
        await page.goto(`file://${REPO}/.superpowers/mockups/${MOCK}?s=${PRESET}&t=${scheme}&w=${dv}`)
        await page.waitForTimeout(500)
        if (process.env.MOCKCLICK) { for (const sel of process.env.MOCKCLICK.split('|')) { await page.locator(sel).first().click(); await page.waitForTimeout(400) } await page.mouse.move(0, 0); await page.waitForTimeout(300) }
        await page.locator('#box').screenshot({ path: `${OUT}/${NAME}-mock-${dv}-${scheme}.png` })
        console.log('shot', NAME, 'mock', dv, scheme)
      }
    } catch (e) { errors.push(`${dv}-${scheme} ${String(e).slice(0, 160)}`) }
    await ctx.close()
  }
}
console.log('MISSES', [...misses]); console.log('ERRORS', errors)
await browser.close()
if (errors.length) process.exit(1)
