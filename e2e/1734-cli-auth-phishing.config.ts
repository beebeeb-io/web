import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for task 1734 — the /cli-auth approval page
 * must not approve a device from a link. Runs ONLY 1734-cli-auth-phishing.spec.ts,
 * with no dependency on global.setup's shared storageState: the spec signs the
 * "victim" in per-test through the dev-only `/dev/auto-login` bypass
 * (`?dev_email=...`), same pattern as e2e/1536-pat-create-step-up.spec.ts, and
 * plays the "attacker's device" from Node over the real device-auth WebSocket.
 *
 * Designed to run through e2e/scripts/web-e2e.sh, which runs a (debug —
 * `/dev/auto-login` is compiled out of release builds) beebeeb-api built from
 * repos/server (or E2E_API_BIN) against a PRIVATE DB, sets E2E_WEB_URL /
 * E2E_API_URL, and sets E2E_NO_WEBSERVER=1 because it manages its own Vite.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const WEB_PORT = new URL(WEB_URL).port || '5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: '.',
  testMatch: /1734-cli-auth-phishing\.spec\.ts$/,
  // A debug API derives the dev account's master key server-side (~10 s a login).
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    viewport: { width: 1280, height: 1000 },
    actionTimeout: 20_000,
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
