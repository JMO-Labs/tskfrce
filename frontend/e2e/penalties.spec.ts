import { expect, test } from '@playwright/test'
import { cheer, parentApi } from './seed'

const BASE = process.env.E2E_BASE_URL ?? 'http://10.99.0.5:3000'

test.use({ actionTimeout: 15_000 })

// Journey: penalties on -> parent gives Medium (device block) -> kid app card says "No devices until" -> parent forgives -> card gone.
test('penalties: give Medium, kid sees the card, forgive clears it', async ({ browser }) => {
  const api = await parentApi()
  const devs: { id: number; name: string }[] = await (await api.get('/api/proxy/devices')).json()
  const mine = devs.filter((d) => d.name.includes('e2e-run'))
  test.skip(!mine.length, 'e2e container device was not discovered by the blocker')

  const fam = await (await api.get('/api/proxy/family')).json()
  const wasOn: boolean = !!fam.penalties_enabled
  await api.patch('/api/proxy/family', { data: { penalties_enabled: true } })
  const kid = await (await api.post('/api/proxy/kids', { data: { full_name: 'Pen', pin: '1234', age_group: 'teen' } })).json()
  const own = (ids: number[]) =>
    Promise.all(mine.map((d) => api.patch(`/api/proxy/devices/${d.id}`, { data: { owner_ids: ids } })))
  try {
    await own([kid.id])
    const opts = await (await api.get('/api/proxy/penalties/options')).json()
    const med = opts.sizes.medium
    const res = await api.post('/api/proxy/penalties', {
      data: { kid_ids: [kid.id], kind: med.kind, amount: med.amount, earn_back: med.earn_back, reason: 'E2E test' },
    })
    expect(res.status()).toBe(201)
    const [pen] = await res.json()

    const kctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } })
    const kp = await kctx.newPage()
    try {
      await kp.goto('/kid')
      await kp.waitForTimeout(2500) // the pin pad takes the keyboard once it has hydrated
      await kp.keyboard.type('1234')
      await cheer(kp)
      const card = kp.getByTestId('penalty-card')
      await expect(card).toBeVisible()
      await expect(card.locator('h3')).toContainText(/^No devices until/)
      await expect(card).toContainText('E2E test')

      expect((await api.post(`/api/proxy/penalties/${pen.id}/forgive`)).ok()).toBe(true)
      await kp.reload()
      await expect(kp.getByTestId('penalty-card')).toHaveCount(0)
    } finally {
      await kctx.close()
    }
  } finally {
    await own([])
    await api.delete(`/api/proxy/kids/${kid.id}`)
    await api.patch('/api/proxy/family', { data: { penalties_enabled: wasOn } })
    await api.dispose()
  }
})
