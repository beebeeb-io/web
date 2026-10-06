import { defineConfig } from '@playwright/test'

/**
 * Standalone config for 1743-return-to-app.spec.ts (task 1743). The first test mocks
 * every API call itself; the second (the real rung) needs a local API with the mock
 * Mollie and a pre-seeded session token, see the spec header. Own ports via env, no
 * global setup, no storage state.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  testMatch: /1743-return-to-app\.spec\.ts$/,
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
