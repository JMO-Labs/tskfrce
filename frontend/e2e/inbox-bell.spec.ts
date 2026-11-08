import { expect, test } from '@playwright/test'
import { loginUi } from './seed'

// Desktop bell pop-over: the "..." menu is portalled into the pop-over, so choosing an item must not close it.
// Uses the lab-seeded "E2E inbox" chore (a submission waiting for the parent).
test.use({ viewport: { width: 1280, height: 900 } })

test('bell: "..." > Send back with a note sends, then "..." > Dismiss removes the row', async ({ page }) => {
  await loginUi(page)
  await page.getByRole('button', { name: /^Notifications/ }).click()
  const bell = page.getByRole('dialog', { name: /^Notifications/ })
  const row = bell.locator('.p-arow').filter({ hasText: 'E2E inbox' })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: /^More for/ }).click()
  await page.getByRole('menuitem', { name: 'Send back' }).click()
  await expect(bell).toBeVisible() // the menu click must not count as an outside click
  const sent = page.waitForRequest((r) => /\/chores\/\d+\/send-back/.test(r.url()) && r.method() === 'POST')
  await bell.getByLabel('Note for sending back').fill('Under the couch too')
  await bell.getByRole('button', { name: 'Send', exact: true }).click()
  await sent
  await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0)

  await row.getByRole('button', { name: /^More for/ }).click()
  await page.getByRole('menuitem', { name: 'Dismiss' }).click()
  await expect(bell).toBeVisible()
  await expect(row).toHaveCount(0)
})

test('bell: Esc in a "..." menu closes the menu, not the bell', async ({ page }) => {
  await loginUi(page)
  await page.getByRole('button', { name: /^Notifications/ }).click()
  const bell = page.getByRole('dialog', { name: /^Notifications/ })
  const more = bell.getByRole('button', { name: /^More for/ }).first()
  await more.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(bell).toBeVisible()
  await expect(more).toBeFocused()
})
