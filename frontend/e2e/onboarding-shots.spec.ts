import { test } from '@playwright/test'

const SHOTS = process.env.E2E_SHOTS_DIR ?? 'e2e-artifacts/screens'

test('offline page', async ({ page }, info) => {
  await page.goto('/offline.html')
  await page.getByRole('button', { name: 'Try again' }).waitFor()
  await page.screenshot({ path: `${SHOTS}/${info.project.name}/offline.png` })
})

test('home screen icons', async ({ page }, info) => {
  // the maskable icon is shown inside a circle covering the 80% safe zone, as a launcher would crop it
  await page.setContent(`<body style="margin:0;display:flex;gap:24px;justify-content:center;align-items:center;min-height:100vh;background:#888">
    <img src="${new URL('/icons/icon-512.png', info.project.use.baseURL ?? process.env.E2E_BASE_URL).href}" width="160" height="160" style="border-radius:22%">
    <img src="${new URL('/icons/icon-maskable-512.png', info.project.use.baseURL ?? process.env.E2E_BASE_URL).href}" width="160" height="160" style="border-radius:50%"></body>`)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `${SHOTS}/${info.project.name}/home-icons.png` })
})
