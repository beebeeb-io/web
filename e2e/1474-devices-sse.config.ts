import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for task 1474 (`useSessionSSE` uses a fresh
 * stream token). Runs ONLY 1474-devices-sse.spec.ts with a fresh context (no
 * server, no storageState, no global setup) — the spec mocks the entire API
 * itself, mirroring 0905's `trial-0905.config.ts`.
 *
 * `webServer` boots this task's OWN `bun dev` on a port that is neither the
 * default dev port (5173/5174) nor the isolated e2e harness's singleton
 * (:3003) — task 1474's brief explicitly requires this to avoid colliding
 * with another lane's dev server or the machine-wide e2e harness.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5187'
const WEB_PORT = new URL(WEB_URL).port

export default defineConfig({
  testDir: '.',
  testMatch: /1474-devices-sse\.spec\.ts$/,
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `bunx vite --port ${WEB_PORT} --strictPort`,
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
