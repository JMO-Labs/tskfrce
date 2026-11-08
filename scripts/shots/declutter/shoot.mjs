// Declutter shot script. Usage: node shoot.mjs <outDir> <name> <appPath> [<mockupFile> <preset>]
// Shoots phone + desktop x light + dark of <appPath> (and the mockup's #box when given). Env DESKTOP_H sets desktop height (default 900).
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { route, S } from './mock.mjs'
const { chromium } = createRequire(new URL('../../../frontend/package.json', import.meta.url))('playwright')
const [OUT, NAME, APP, MOCK, PRESET] = process.argv.slice(2)
if (!OUT || !NAME || !APP) { console.error('usage: shoot.mjs <outDir> <name> <appPath> [<mockupFile> <preset>]'); process.exit(1) }
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
    S.setup = { needed: false }; S.step = null
    try {
      await page.goto(`${BASE}/login`, { timeout: 240000 })
      await page.getByLabel('Username', { exact: true }).fill('dad')
      await page.getByLabel('Password', { exact: true }).fill('pw12345678')
      await page.getByRole('button', { name: 'Log in' }).click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 240000 })
      await page.goto(`${BASE}${APP}`, { timeout: 240000 })
      await page.locator('main').first().waitFor({ timeout: 240000 })
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `${OUT}/${NAME}-${dv}-${scheme}.png` })
      console.log('shot', NAME, dv, scheme)
      if (MOCK && PRESET) {
        await page.goto(`file://${REPO}/.superpowers/mockups/${MOCK}?s=${PRESET}&t=${scheme}&w=${dv}`)
        await page.waitForTimeout(500)
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
