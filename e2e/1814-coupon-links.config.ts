import { defineConfig } from '@playwright/test'

/**
 * Standalone config for 1814-coupon-links.spec.ts (task 1814, slice A). The spec
 * creates its own admin token and signs brand-new accounts up through the
 * document-driven /signup, so it needs neither global.setup's dev auto-login nor
 * the 'authenticated' project's storage state.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /1814-coupon-links\.spec\.ts$/,
  timeout: 600_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
})
