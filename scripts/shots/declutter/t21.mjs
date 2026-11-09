// Task 21 shots + phone touch-target audit. Usage: node t21.mjs <outDir> <tag> [scenario,...]  (tag = before|after). Dev server on 127.0.0.1:3295.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { route, S } from './mock.mjs'
const { chromium } = createRequire(new URL('../../../frontend/package.json', import.meta.url))('playwright')
const [OUT, TAG, ONLY] = process.argv.slice(2)
const BASE = 'http://127.0.0.1:3295'
mkdirSync(OUT, { recursive: true })
const focusTab = async (p, n) => { for (let i = 0; i < n; i++) await p.keyboard.press('Tab') }
const SC = {
  'focus-switch': { path: '/devices?net=net', step: async (p) => { await p.locator('[role=switch], .ch-sw').first().focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab') } },
  'focus-avatar': { path: '/setup', setupStep: 3, step: async (p) => { await p.getByRole('button', { name: /Pick an avatar/ }).click(); await p.waitForTimeout(300); await p.keyboard.press('Tab'); await p.keyboard.press('Tab') } },
  'focus-wizard': { path: '/setup', setupStep: 6, step: async (p) => { await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab') } },
  'savebar': { path: '/kids?section=badges&item=custom&pick=new', step: async (p) => { await p.getByLabel('Badge name').fill('Kindness'); await p.waitForTimeout(400) } },
  'chips-kid': { path: '/kids?section=kids&item=3' },
  'chips-chore': { path: '/kids?section=chores&item=400' },
  'back-settings': { path: '/settings?section=family' },
  'back-rewards': { path: '/kids?section=rewards&item=requests' },
}
if (TAG === 'audit') for (const [k, p] of Object.entries({ today: '/', 'today-needs': '/?focus=needs', 'kid-open': '/kids?section=kids&item=8&open=settings&edit=1', 'kid-trust': '/kids?section=kids&item=8&open=trust', 'chore-open': '/kids?section=chores&item=5&open=who', 'chore-basics': '/kids?section=chores&item=5&open=basics', devices: '/devices', 'dev-net': '/devices?net=net', 'dev-open': '/devices?item=1&open=now', 'dev-details': '/devices?item=1&open=details', groups: '/devices?tab=groups', 'settings-fam': '/settings?section=family&open=hh', 'settings-notif': '/settings?section=notifications&open=quiet', 'settings-list': '/settings', rewards: '/kids?section=rewards&item=catalogue', 'rewards-screen': '/kids?section=rewards&item=screen&open=price', badges: '/kids?section=badges&item=custom&pick=3', recap: '/recap' })) SC[k] = { path: p }
const browser = await chromium.launch()
const audit = []
for (const [name, sc] of Object.entries(SC)) {
  if (ONLY && !ONLY.split(',').includes(name)) continue
  if (TAG === 'audit' && !sc.path) continue
  for (const [dv, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]].filter(([d]) => TAG !== 'audit' || d === 'phone')) {
    for (const scheme of (TAG === 'audit' ? ['light'] : ['light', 'dark'])) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, isMobile: dv === 'phone', hasTouch: dv === 'phone', deviceScaleFactor: dv === 'phone' ? 2 : 1 })
      const page = await ctx.newPage()
      await page.route('**/api/proxy/**', (r) => route(r, new Set()))
      S.setup = { needed: false }; S.step = sc.setupStep ?? null
      try {
        await page.goto(`${BASE}/login`, { timeout: 240000 })
        await page.getByLabel('Username', { exact: true }).fill('dad')
        await page.getByLabel('Password', { exact: true }).fill('pw12345678')
        await page.getByRole('button', { name: 'Log in' }).click()
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 240000 })
        await page.goto(`${BASE}${sc.path}`, { timeout: 240000 })
        await page.locator('main').first().waitFor({ timeout: 240000 })
        await page.waitForTimeout(1500)
        if (sc.step) await sc.step(page)
        await page.waitForTimeout(300)
        await page.screenshot({ path: `${OUT}/${name}-${TAG}-${dv}-${scheme}.png` })
        if (dv === 'phone' && scheme === 'light') {
          const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href], [role=switch], [role=tab], [role=button], input:not([type=hidden]), select, summary')].map((e) => {
            const r = e.getBoundingClientRect(), cs = getComputedStyle(e)
            return { e, r, cs }
          }).filter(({ r, cs }) => r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (r.height < 43.5 || r.width < 43.5)).map(({ e, r }) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')}[${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`))
          audit.push(`## ${name}\n${[...new Set(small)].join('\n')}`)
        }
        console.log('shot', name, dv, scheme)
      } catch (e) { console.log('ERR', name, dv, scheme, String(e).slice(0, 160)) }
      await ctx.close()
    }
  }
}
console.log(audit.join('\n'))
await browser.close()
