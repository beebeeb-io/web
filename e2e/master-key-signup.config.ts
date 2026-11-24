// Standalone Playwright config for the master-key sign-up spec, with no shared setup or storage state.
import { defineConfig } from '@playwright/test'

/**
 * Standalone config for master-key-signup.spec.ts (epic master-key-naming; copy of the 1745 config, verification
 * rungs, real stack). The spec signs brand-new accounts up through the
 * document-driven /signup itself, so it needs neither global.setup's dev
 * auto-login nor the 'authenticated' project's storage state. web-e2e.sh
 * auto-detects this sibling config (spec_config_for).
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /master-key-signup\.spec\.ts$/,
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
