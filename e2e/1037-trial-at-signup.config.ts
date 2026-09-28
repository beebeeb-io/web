import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for task 1037 (no free signups — trial with a
 * payment mandate). Runs ONLY 1037-trial-at-signup.spec.ts against a running
 * Vite dev server (E2E_WEB_URL) with a fresh context — no API server, no
 * storageState, no global setup: the spec mocks the API itself, the same
 * pattern as 1517-trial-used-upgrade.config.ts. Mollie's hosted checkout
 * cannot run here, so the mocked `/billing/trial/checkout` "redirects" to the
 * real return URL (`/choose-plan?returned=1`).
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /1037-trial-at-signup\.spec\.ts$/,
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
