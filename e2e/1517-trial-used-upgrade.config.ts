import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for the 1517 trial-already-used verification.
 * Runs ONLY 1517-trial-used-upgrade.spec.ts with a fresh context (no server,
 * no storageState, no global setup) — the spec mocks the entire API itself,
 * mirroring checkout-redirect-0865.config.ts.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /1517-trial-used-upgrade\.spec\.ts$/,
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
