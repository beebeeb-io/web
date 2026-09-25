import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for task 1536 — creating a personal access
 * token from a session requires a step-up `X-Confirm-Token` (the post-server-#98
 * contract). Runs ONLY 1536-pat-create-step-up.spec.ts, with no dependency on
 * global.setup's shared storageState — the spec authenticates itself
 * per-test via the dev-only `/dev/auto-login` bypass (`?dev_email=...`),
 * same pattern as e2e/1493-passkey-add-step-up.spec.ts.
 *
 * Designed to run through e2e/scripts/web-e2e.sh, which runs a beebeeb-api
 * built from repos/server (or E2E_API_BIN) against a PRIVATE DB, sets
 * E2E_WEB_URL / E2E_API_URL, and sets E2E_NO_WEBSERVER=1 because it manages
 * its own isolated Vite. Falls back to sane localhost defaults for a manual
 * run with `bun dev` / `cargo run` already up.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const WEB_PORT = new URL(WEB_URL).port || '5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: '.',
  testMatch: /1536-pat-create-step-up\.spec\.ts$/,
  timeout: 60_000,
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
