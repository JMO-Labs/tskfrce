import { defineConfig } from '@playwright/test'

const size = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } }
const projects = (['desktop', 'phone'] as const).flatMap((s) =>
  (['light', 'dark'] as const).map((colorScheme) => ({
    name: `${s}-${colorScheme}`,
    testMatch: ['screens.spec.ts', 'onboarding-shots.spec.ts'],
    use: { viewport: size[s], colorScheme, isMobile: s === 'phone' },
  })),
)

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-artifacts/results',
  timeout: 90_000, // the dev server compiles each page on first visit
  expect: { timeout: 20_000 },
  workers: 1,
  // CI: one retry for the read-only screenshot projects so a dev-server compile stall doesn't fail
  // the run; a retried pass shows as "flaky" in the summary. Journeys mutate state: never retried.
  retries: 0,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://10.99.0.5:3000', trace: 'on-first-retry' },
  // journeys change state, so they run once, after every screenshot of the seeded data
  projects: [
    ...projects.map((p) => ({ ...p, retries: process.env.CI ? 1 : 0 })),
    {
      name: 'journeys',
      testMatch: ['parent.spec.ts', 'declutter-nav.spec.ts', 'chore-model.spec.ts', 'kid-app.spec.ts', 'devices-hours.spec.ts', 'notifications.spec.ts', 'inbox-bell.spec.ts', 'rewards.spec.ts'],
      retries: 0,
      dependencies: projects.map((p) => p.name),
      use: { viewport: size.desktop, colorScheme: 'light' },
    },
  ],
})
