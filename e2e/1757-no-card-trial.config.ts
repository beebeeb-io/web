import { defineConfig } from '@playwright/test'

/**
 * Standalone config for 1757-no-card-trial.spec.ts (task 1757 verification
 * rungs, real stack). The spec signs brand-new accounts up through the
 * document-driven /signup itself, so it needs neither global.setup's dev
 * auto-login nor the 'authenticated' project's storage state. web-e2e.sh
 * auto-detects this sibling config (spec_config_for).
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /1757-no-card-trial\.spec\.ts$/,
  timeout: 300_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
