import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for e2e/flow6-cli-own-session.spec.ts — the
 * real-stack proof that `bb login` (browser approval at /cli-auth) gives the
 * CLI its OWN session instead of a copy of the browser's.
 *
 * Self-contained: no global.setup / storageState dependency — the spec
 * authenticates per-test via the dev-only `/dev/auto-login` bypass
 * (`?dev_email=...`), same pattern as e2e/1536-pat-create-step-up.spec.ts.
 * Run it through e2e/scripts/web-e2e.sh with E2E_BB_BIN pointing at a built
 * `bb` binary (the spec self-skips without one).
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const WEB_PORT = new URL(WEB_URL).port || '5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: '.',
  testMatch: /flow6-cli-own-session\.spec\.ts$/,
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        command: `VITE_API_URL=${API_URL} bunx vite --port ${WEB_PORT} --strictPort`,
        url: WEB_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
