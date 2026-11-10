import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { loginUi, makeKid, parentApi } from './seed'

// Real Next routing (jest fakes the router): focus params, Back, tab bar, the discard guard.
// one login for the file (login is rate limited to 10/min, and the specs after this one log in too)
const STATE = join(tmpdir(), `declutter-nav-state-${process.pid}.json`) // holds a session: never under e2e-artifacts (CI uploads it)
const BASE = process.env.E2E_BASE_URL ?? 'http://10.99.0.5:3000'
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15_000, storageState: STATE })

const tag = Date.now().toString(36).slice(-4)
let api: APIRequestContext
let kid: { id: number; full_name: string }
let undo: () => Promise<unknown>
const errors: string[] = []

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } })
  await loginUi(await ctx.newPage())
  await ctx.storageState({ path: STATE })
  await ctx.close()
  api = await parentApi()
  const k = await makeKid(api, `Nav ${tag}`)
  kid = k.kid
  undo = k.undo
})
test.afterAll(async () => {
  rmSync(STATE, { force: true })
  await undo()
  await api.dispose()
})
test.beforeEach(async ({ page }) => {
  errors.length = 0
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
})

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })
const discardSheet = (page: Page) => page.getByRole('dialog', { name: 'Discard changes?' })
const noNavErrors = () => expect(errors.filter((e) => /cancel|Unhandled|Route change/i.test(e))).toEqual([])

test('Back closes a section before it leaves the page', async ({ page }) => {
  await page.goto('/')
  await page.locator('.pt-krow').filter({ hasText: `Nav ${tag}` }).click()
  await expect(page).toHaveURL(new RegExp(`kid=${kid.id}`))
  await page.goBack()
  await expect(page).toHaveURL(/\/(\?.*)?$/)
  await expect(page).not.toHaveURL(/kid=/)
  await expect(tab(page, 'Today')).toHaveAttribute('aria-current', 'page')
})

test('tab bar from a focused section goes to that tab calm', async ({ page }) => {
  await page.goto(`/kids?section=kids&item=${kid.id}&open=trust`)
  await expect(page.getByRole('region', { name: 'Trust' })).toBeVisible()
  await tab(page, 'Kids').click()
  await expect(page).not.toHaveURL(/open=/)
  await expect(page.getByRole('region', { name: 'Trust' })).toHaveCount(0)

  await page.goto(`/?kid=${kid.id}`)
  await tab(page, 'Today').click()
  await expect(page).not.toHaveURL(/kid=/)
})

test('refresh keeps the focus state', async ({ page }) => {
  await page.goto(`/kids?section=kids&item=${kid.id}&open=trust`)
  await expect(page.getByRole('region', { name: 'Trust' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Trust' })).toBeVisible()
  await expect(page).toHaveURL(/open=trust/)
})

test('URL-opened row shows no ring; Tab shows the one ring', async ({ page }) => {
  await page.goto(`/kids?section=kids&item=${kid.id}&open=trust`)
  const region = page.getByRole('region', { name: 'Trust' })
  await expect(region).toBeVisible()
  await expect(region).toBeFocused()
  const ring = () => page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element)
    return { style: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow }
  })
  expect(await ring()).toMatchObject({ style: 'none', shadow: 'none' })
  await page.keyboard.press('Tab')
  expect((await ring()).width).toBe('2px')
  // a Mantine field (.f-input) clicked: the one ring, no kid sun shadow on top
  await page.goto('/settings?section=notifications')
  await page.getByRole('button', { name: 'Add a place' }).first().click()
  const name = page.getByLabel('Name', { exact: true })
  await name.click()
  await expect(name).toHaveClass(/f-input/)
  expect(await ring()).toMatchObject({ style: 'solid', width: '2px', shadow: 'none' })
})

test('header and tab bar do not move when a section opens', async ({ page }) => {
  await page.goto(`/kids?section=kids&item=${kid.id}`)
  const header = page.locator('header').first()
  const bar = page.getByRole('navigation', { name: 'Main' })
  await expect(bar).toBeVisible()
  const before = [await header.boundingBox(), await bar.boundingBox()]
  await page.locator('[data-focus-head="trust"]').click()
  await expect(page.getByRole('region', { name: 'Trust' })).toBeVisible()
  expect([await header.boundingBox(), await bar.boundingBox()]).toEqual(before)
})

test('old links still land', async ({ page }) => {
  await page.goto('/?tab=needs')
  await expect(page).toHaveURL(/focus=needs/)
  await page.goto(`/?item=${kid.id}`)
  await expect(page).toHaveURL(new RegExp(`kid=${kid.id}`))
  await expect(page).not.toHaveURL(/item=/)
})

test.describe('unsaved-changes guard', () => {
  const startEdit = async (page: Page) => {
    await page.goto(`/kids?section=kids&item=${kid.id}`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const name = page.getByLabel('Name', { exact: true })
    await name.fill(`Renamed ${tag}`)
    // the guard registers its Back handler a render or two after the typing; a person is never that quick
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible() // the guard registers with the dirty state
    return name
  }

  test('tab bar: one prompt, Keep stays on the edit, Discard leaves', async ({ page }) => {
    const name = await startEdit(page)
    await tab(page, 'Kids').click()
    await expect(discardSheet(page)).toHaveCount(1)
    await discardSheet(page).getByRole('button', { name: 'Keep' }).click()
    await expect(discardSheet(page)).toHaveCount(0)
    await expect(name).toHaveValue(`Renamed ${tag}`)
    await expect(page).toHaveURL(/edit=1/)

    await tab(page, 'Devices').click()
    await expect(discardSheet(page)).toHaveCount(1)
    await discardSheet(page).getByRole('button', { name: 'Discard' }).click()
    await expect(page).toHaveURL(/\/devices/)
    await noNavErrors()
    const kids: { id: number; full_name: string }[] = await (await api.get('/api/proxy/kids')).json()
    expect(kids.find((k) => k.id === kid.id)?.full_name).toBe(`Nav ${tag}`)
  })

  test('browser Back: one prompt, Keep stays, Discard goes back', async ({ page }) => {
    // in-app steps only (list -> kid -> Edit), so every Back is a popstate Next can intercept
    await page.goto('/kids?section=kids')
    await page.getByRole('button', { name: new RegExp(`^Nav ${tag}`) }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const name = page.getByLabel('Name', { exact: true })
    await name.fill(`Renamed ${tag}`)
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible()

    await page.goBack()
    await expect(discardSheet(page)).toHaveCount(1)
    await discardSheet(page).getByRole('button', { name: 'Keep' }).click()
    await expect(discardSheet(page)).toHaveCount(0)
    await expect(name).toHaveValue(`Renamed ${tag}`)
    await expect(page).toHaveURL(/edit=1/)

    await page.goBack()
    await expect(discardSheet(page)).toHaveCount(1)
    await discardSheet(page).getByRole('button', { name: 'Discard' }).click()
    await expect(discardSheet(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/edit=1/)
    await expect(page).toHaveURL(new RegExp(`item=${kid.id}`))
    await noNavErrors()
  })

  test('chore editor: leaving asks once, Discard restores the saved name', async ({ page }) => {
    const title = `Nav chore ${tag}`
    const chore = await (await api.post('/api/proxy/chores/', { data: { title, points: 5 } })).json()
    try {
      await page.goto(`/kids?section=chores&item=${chore.id}`)
      await page.locator('[data-focus-head="basics"]').click()
      const name = page.getByLabel('Chore name', { exact: true })
      await expect(name).toHaveValue(title)
      await name.fill(`${title} edited`)
      await page.locator('a.p-back-link').click() // the way to another chore on a phone
      await expect(discardSheet(page)).toHaveCount(1)
      await discardSheet(page).getByRole('button', { name: 'Discard' }).click()
      await expect(page).not.toHaveURL(/item=/)
      await page.locator('summary', { hasText: 'Other' }).click() // the list is calm: the group holding the chore is folded
      await page.getByRole('button', { name: new RegExp(`^${title}`) }).first().click()
      await page.locator('[data-focus-head="basics"]').click()
      await expect(page.getByLabel('Chore name', { exact: true })).toHaveValue(title)
      await noNavErrors()
    } finally {
      await api.delete(`/api/proxy/chores/${chore.id}`)
    }
  })

  test('chore editor: Back from an open row closes it without a prompt and keeps the edit', async ({ page }) => {
    const title = `Nav back ${tag}`
    const chore = await (await api.post('/api/proxy/chores/', { data: { title, points: 5 } })).json()
    try {
      await page.goto(`/kids?section=chores&item=${chore.id}`)
      await page.locator('[data-focus-head="basics"]').click()
      await expect(page).toHaveURL(/open=basics/)
      await page.getByLabel('Chore name', { exact: true }).fill(`${title} edited`)
      await page.goBack()
      await expect(page).not.toHaveURL(/open=/)
      await expect(discardSheet(page)).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible()
      await noNavErrors()
    } finally {
      await api.delete(`/api/proxy/chores/${chore.id}`)
    }
  })

  test.describe('desktop list beside the editor', () => {
    test.use({ viewport: { width: 1280, height: 800 } })
    test('picking another chore asks once, Discard brings the original back', async ({ page }) => {
      const a = await (await api.post('/api/proxy/chores/', { data: { title: `Nav A ${tag}`, points: 5 } })).json()
      const b = await (await api.post('/api/proxy/chores/', { data: { title: `Nav B ${tag}`, points: 5 } })).json()
      try {
        await page.goto(`/kids?section=chores&item=${a.id}`)
        await page.locator('[data-focus-head="basics"]').click()
        await page.getByLabel('Chore name', { exact: true }).fill(`Nav A ${tag} edited`)
        await page.locator('.p-list-column').getByRole('button', { name: new RegExp(`^Nav B ${tag}`) }).click()
        await expect(discardSheet(page)).toHaveCount(1)
        await discardSheet(page).getByRole('button', { name: 'Discard' }).click()
        await expect(page).toHaveURL(new RegExp(`item=${b.id}`))
        await page.locator('.p-list-column').getByRole('button', { name: new RegExp(`^Nav A ${tag}`) }).click()
        await expect(discardSheet(page)).toHaveCount(0)
        await page.locator('[data-focus-head="basics"]').click()
        await expect(page.getByLabel('Chore name', { exact: true })).toHaveValue(`Nav A ${tag}`)
        await noNavErrors()
      } finally {
        await api.delete(`/api/proxy/chores/${a.id}`)
        await api.delete(`/api/proxy/chores/${b.id}`)
      }
    })
  })

  test('Escape in an open row saves the value', async ({ page }) => {
    const before = (await (await api.get('/api/proxy/family')).json()).screen_time_price
    try {
      await page.goto('/kids?section=rewards&item=screen&open=price')
      await page.getByLabel('Points per 15 min').fill(String(before + 1))
      await page.keyboard.press('Escape')
      await expect
        .poll(async () => (await (await api.get('/api/proxy/family')).json()).screen_time_price)
        .toBe(before + 1)
      await page.reload()
      await expect(page).toHaveURL(/screen/)
      await expect(page.locator('[data-focus-head="price"]').filter({ hasText: `${before + 1} pts` })).toBeVisible()
    } finally {
      await api.patch('/api/proxy/family', { data: { screen_time_price: before } })
    }
  })
})
