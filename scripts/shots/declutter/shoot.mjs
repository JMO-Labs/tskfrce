// Declutter audit shot script, copied as-is. Plan Task 1 turns it into shoot.mjs (see the plan). Usage today: node shoot.mjs <outdir> [phone|desktop]
import { chromium } from '/home/user/code/tskfrce-trust/frontend/node_modules/playwright/index.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { route, S } from './mock.mjs'
const OUT = process.argv[2], ONLY = process.argv[3], BASE = 'http://127.0.0.1:3295'
mkdirSync(OUT, { recursive: true })
const misses = new Set(), errors = [], counts = {}
const COUNT = () => {
  const vh = innerHeight, vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 2 && b.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 }
  const scope = document.querySelector('main') ?? document.body
  const roots = [scope, ...document.querySelectorAll('[role=dialog]')]
  const all = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]).filter(vis)
  const top = (e) => e.getBoundingClientRect().top + scrollY
  const cls = (e) => (e.className?.baseVal ?? e.className ?? '').toString()
  const ctrls = all('button, a[href], input:not([type=hidden]), select, textarea, [role=switch], [role=tab], [role=checkbox], [role=radio]')
  const ctrlSet = new Set(ctrls)
  const chips = all('[class]').filter((e) => /(^|[-_ ])(chip|badge|pill|tag|pip|dot)s?($|[-_ ])/i.test(cls(e)) && !ctrlSet.has(e) && !ctrls.some((c) => c.contains(e)))
  const cards = all('[class]').filter((e) => cls(e).split(/\s+/).some((t) => /^(?!.*(grid|list|rows|cards)$)[\w-]*(card|tile|row|item|fold|panel|section)$/i.test(t)) && !ctrlSet.has(e))
  const texts0 = all('h1,h2,h3,h4,h5,p,small,label,li,dt,dd,figcaption,[class*=hint],[class*=sub]').filter((e) => e.innerText?.trim() && !ctrls.some((c) => c.contains(e)))
  const texts = texts0.filter((e) => !texts0.some((o) => o !== e && e.contains(o)))
  window.__cards = cards.map(cls)
  const k = (arr) => ({ fold: arr.filter((e) => top(e) < vh).length, total: arr.length })
  return { controls: k(ctrls), chips: k(chips), cards: k(cards), texts: k(texts), height: document.documentElement.scrollHeight }
}
const EXPAND = () => {
  window.__restore = []
  const fix = (e) => { window.__restore.push([e, e.getAttribute('style') ?? '']); e.style.setProperty('height', 'auto', 'important'); e.style.setProperty('max-height', 'none', 'important'); e.style.setProperty('overflow', 'visible', 'important') }
  const scrollers = [...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4 && !e.closest('[role=dialog]') })
  const done = new Set()
  for (const e of scrollers) { let x = e; while (x && x !== document.documentElement && !done.has(x)) { done.add(x); fix(x); x = x.parentElement } }
  fix(document.body); fix(document.documentElement)
}
const browser = await chromium.launch()
for (const [dv, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  if (ONLY && ONLY !== dv) continue
  const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light', isMobile: dv === 'phone', hasTouch: dv === 'phone', deviceScaleFactor: dv === 'phone' ? 2 : 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${dv} ${page.url()} ${String(e).slice(0, 160)}`))
  await page.route('**/api/proxy/**', (r) => route(r, misses))
  S.setup = { needed: false }; S.step = null
  await page.goto(`${BASE}/login`, { timeout: 240000 })
  await page.getByLabel('Username', { exact: true }).fill('dad')
  await page.getByLabel('Password', { exact: true }).fill('pw12345678')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 240000 })
  const shot = async (name) => {
    await page.waitForTimeout(1200)
    await page.evaluate(() => scrollTo(0, 0))
    counts[`${name}-${dv}`] = await page.evaluate(COUNT)
    await page.evaluate(EXPAND)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/${name}-${dv}.png`, fullPage: true })
    await page.evaluate(() => { for (const [e, st] of window.__restore ?? []) e.setAttribute('style', st); window.__restore = [] })
    console.log('shot', name, dv)
  }
  const go = async (name, url) => { if (process.env.SCREEN && name !== process.env.SCREEN) return;
    try { await page.goto(`${BASE}${url}`, { timeout: 240000 }); await page.locator('main').first().waitFor({ timeout: 240000 }); await page.waitForTimeout(1500); await shot(name) } catch (e) { errors.push(`${name} ${dv} ${String(e).slice(0, 160)}`) }
  }
  const tryDo = async (name, fn) => { if (process.env.SCREEN && name !== process.env.SCREEN) return; try { await fn(); await shot(name) } catch (e) { errors.push(`${name} ${dv} ${String(e).slice(0, 160)}`) } await page.keyboard.press('Escape').catch(() => {}) }
  await go('today', '/')
  await tryDo('today-chore-open', () => page.locator('.pt-chore').first().click())
  await go('today', '/')
  await tryDo('today-needs', async () => { if (dv === 'phone') await page.getByRole('button', { name: /Needs you/ }).first().click(); else await page.getByRole('tab', { name: /Needs you/ }).click() })
  await go('kids-chores', '/kids?section=chores')
  await go('chore-edit', '/kids?section=chores&item=404')
  await go('chore-new', '/kids?section=chores&item=new')
  await go('kids-list', '/kids?section=kids')
  await go('kid', '/kids?section=kids&item=3')
  await tryDo('kid-edit', () => page.locator('#kid-act-edit').click())
  await go('kid-leo', '/kids?section=kids&item=4')
  for (const it of ['requests', 'catalogue', 'screen', 'happy', 'history']) await go(`rewards-${it}`, `/kids?section=rewards&item=${it}`)
  await go('rewards-nav', '/kids?section=rewards')
  for (const it of ['all', 'custom', 'recent']) await go(`badges-${it}`, `/kids?section=badges&item=${it}`)
  await go('devices', '/devices')
  await go('device', '/devices?item=12')
  for (const t of ['Network', 'Activity']) await tryDo(`device-${t.toLowerCase()}`, () => page.getByRole('tab', { name: t }).click())
  await go('groups', '/devices?tab=groups')
  await go('group', '/devices?tab=groups&item=1')
  await go('settings', '/settings')
  for (const s of ['family', 'hours', 'notifications', 'look', 'gifs', 'parents', 'integrations']) await go(`settings-${s}`, `/settings?section=${s}`)
  await go('notifications', '/notifications')
  await go('recap', '/recap')
  await go('chat', '/chat')
  await go('chat-thread', '/chat?item=family:family')
  await go('more', '/more')
  for (const st of [3, 4, 5, 6, 7, 8]) { S.step = st; await go(`setup-${st}`, '/setup') }
  S.step = null
  await ctx.close()
  // steps 1-2: logged out, fresh install
  const c2 = await browser.newContext({ viewport: vp, colorScheme: 'light', isMobile: dv === 'phone', hasTouch: dv === 'phone', deviceScaleFactor: dv === 'phone' ? 2 : 1 })
  const p2 = await c2.newPage()
  S.setup = { needed: true }
  await p2.route('**/api/proxy/**', (r) => route(r, misses))
  try { await p2.goto(`${BASE}/setup`, { timeout: 240000 }); await p2.waitForTimeout(3000); await p2.screenshot({ path: `${OUT}/setup-1-${dv}.png`, fullPage: true }) } catch (e) { errors.push('setup1 ' + e) }
  await c2.close()
}
writeFileSync(`${OUT}/counts.json`, JSON.stringify(counts, null, 1))
console.log('MISSES', [...misses]); console.log('ERRORS', errors)
await browser.close()
