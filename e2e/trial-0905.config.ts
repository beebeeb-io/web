import { defineConfig } from '@playwright/test'
import path from 'path'

/**
 * Standalone Playwright config for the 0905 14-day free-trial web UI (UNIT C).
 * Runs ONLY trial-0905.spec.ts with a fresh context (no server, no storageState,
 * no global setup) — the spec mocks the entire API itself, mirroring the 0865
 * checkout-redirect config.
 *
 * Task 1604 — added a `webServer` block (previously the caller had to already
 * have `bun dev` running). The spec never makes a real network call (every
 * `/api/v1/*` request is intercepted by `page.route`), so VITE_API_URL is
 * irrelevant here; the default port (5199) is picked to avoid colliding with
 * a developer's or another lane's `bun dev` on :5173 — override with
 * E2E_WEB_URL like before. `reuseExistingServer: true` only ever reuses OUR
 * OWN prior instance on this same dedicated port, never someone else's.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5199'
const WEB_PORT = new URL(WEB_URL).port || '5199'

export default defineConfig({
  testDir: '.',
  testMatch: /trial-0905\.spec\.ts$/,
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
        // This config file lives in e2e/ — Playwright's webServer.cwd
        // defaults to the CONFIG file's directory, not the repo root, which
        // left `bunx vite` serving from e2e/ (no index.html there → every
        // request 404'd, health check spun for the full 60s timeout).
        cwd: path.resolve(__dirname, '..'),
        url: WEB_URL,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
