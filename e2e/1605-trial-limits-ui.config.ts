import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for task 1605 (unpaid-trial limits UI —
 * cancelled-trial dates, 25 GB cap + pay-now, read-only upload error).
 *
 * Web-app-only: no server runs, every API call is mocked with page.route —
 * mirrors e2e/1542-web-billing-copy.config.ts / trial-0905.config.ts. Own
 * isolated port so it never collides with a developer's `bun dev` or another
 * lane's e2e run on :5173.
 */
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5205'
const WEB_URL = process.env.E2E_WEB_URL ?? `http://localhost:${WEB_PORT}`

export default defineConfig({
  testDir: '.',
  testMatch: /1605-trial-limits-ui\.spec\.ts$/,
  timeout: 90_000,
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
        command: `bunx vite --port ${WEB_PORT} --strictPort`,
        cwd: __dirname + '/..',
        url: WEB_URL,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
