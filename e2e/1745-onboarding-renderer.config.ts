import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for task 1745 (onboarding renderer, fixture
 * harness). Web-app-only: no API runs. The renderer is driven from the golden
 * documents at /dev/onboarding/<fixture> with stubbed side effects, and the
 * ceremony runs on the real core WASM. Own port (E2E_VITE_PORT, default 5745)
 * so it never touches :3001, :5173 or another lane's harness.
 */
const WEB_PORT = process.env.E2E_VITE_PORT ?? '5745'
const WEB_URL = process.env.E2E_WEB_URL ?? `http://localhost:${WEB_PORT}`

export default defineConfig({
  testDir: '.',
  testMatch: /1745-onboarding-renderer\.spec\.ts$/,
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
        // VITE_API_URL points at a closed local port: the harness must never reach a real API.
        command: `VITE_API_URL=http://127.0.0.1:9 bunx vite --port ${WEB_PORT} --strictPort`,
        cwd: __dirname + '/..',
        url: WEB_URL,
        reuseExistingServer: false,
        timeout: 90_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
