import { defineConfig } from '@playwright/test'

/**
 * Standalone config for 1918-erase-request.spec.ts (task 1918). Real stack only: a local API
 * built from the server 1918 branch (console email provider, workers on) at E2E_API_URL; this
 * config starts Vite on E2E_WEB_URL's port pointed at it (or reuses one already there). See the
 * spec header for the environment. No global setup, no storage state.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const WEB_PORT = new URL(WEB_URL).port || '5173'

export default defineConfig({
  testDir: '.',
  testMatch: /1918-erase-request\.spec\.ts$/,
  timeout: 600_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `NODE_ENV=test VITE_API_URL=${API_URL} bunx vite --mode test --port ${WEB_PORT} --strictPort`,
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
