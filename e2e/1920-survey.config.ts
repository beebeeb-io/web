import { defineConfig } from '@playwright/test'

/**
 * Standalone config for 1920-survey.spec.ts (task 1920, the exit survey page). The spec seeds
 * its own survey invitations straight into the scratch database and needs neither global.setup's
 * dev auto-login nor the 'authenticated' project's storage state. Own port via E2E_WEB_URL.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /1920-survey\.spec\.ts$/,
  timeout: 40_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
