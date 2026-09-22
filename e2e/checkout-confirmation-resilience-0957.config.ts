import { defineConfig } from '@playwright/test'
import path from 'path'

/**
 * Standalone Playwright config for the 0957 checkout-confirmation resilience
 * verification (spec §3.3 Component C). Mirrors
 * checkout-redirect-0865.config.ts: runs ONLY this spec with a fresh
 * context (no server, no storageState, no global setup) — the spec mocks
 * the entire API itself, including the new `GET /payment/{id}/status`
 * endpoint.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const WEB_PORT = new URL(WEB_URL).port || '5173'

export default defineConfig({
  testDir: '.',
  testMatch: /checkout-confirmation-resilience-0957\.spec\.ts$/,
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Self-contained (mirrors the default playwright.config.ts's own block):
  // boots Vite if nothing is already listening on WEB_PORT, cooperates with
  // an already-running `bun dev` otherwise. No API server is started or
  // needed — every request is mocked in-spec. Foreground only.
  webServer: {
    command: `bunx vite --port ${WEB_PORT} --strictPort`,
    // Playwright runs webServer.command from the CONFIG FILE's directory
    // (e2e/) by default, which has no index.html/vite.config.ts — Vite then
    // serves 404s for `/` and `/index.html` and the readiness check times
    // out. Pin cwd to the repo root, same directory playwright.config.ts's
    // own webServer block runs from implicitly (it lives at the root).
    cwd: path.resolve(__dirname, '..'),
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
