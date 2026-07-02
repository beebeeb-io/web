import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for the 0943 storage-addon + WS confirmation
 * verification. Runs ONLY storage-addon-confirm-0943.spec.ts with a fresh
 * context (no server, no storageState, no global setup) — the spec mocks the
 * entire API itself and fakes the WebSocket via an init script.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /storage-addon-confirm-0943\.spec\.ts$/,
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
