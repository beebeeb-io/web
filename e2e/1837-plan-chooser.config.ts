import { defineConfig } from '@playwright/test'

/**
 * Standalone config for task 1837 (plan chooser: card trial first, "continue without
 * card" second). API-MOCKED, like 1037 / 1517: no server, no storageState. Needs a Vite dev
 * server built WITH `VITE_FEATURE_ONBOARDING_DOCUMENT=true` (the chooser reads the
 * onboarding document) on its OWN port:
 *
 *   VITE_FEATURE_ONBOARDING_DOCUMENT=true bunx vite --port 37971 --strictPort &
 *   E2E_WEB_URL=http://localhost:37971 bunx playwright test --config=e2e/1837-plan-chooser.config.ts
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:37971'

export default defineConfig({
  testDir: '.',
  testMatch: /1837-plan-chooser\.spec\.ts$/,
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
