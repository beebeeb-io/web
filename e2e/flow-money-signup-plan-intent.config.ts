import { defineConfig } from '@playwright/test'

/**
 * Standalone config for flow-money-signup-plan-intent.spec.ts. The spec signs a
 * brand-new account up through /signup itself (fresh storageState), so it needs
 * neither global.setup's dev auto-login nor the 'authenticated' project's saved
 * storage state — depending on them only adds a failure mode unrelated to what
 * the spec proves. `e2e/scripts/web-e2e.sh` auto-detects this sibling config
 * (spec_config_for) and runs the spec against its isolated real API + Vite.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /flow-money-signup-plan-intent\.spec\.ts$/,
  timeout: 240_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
