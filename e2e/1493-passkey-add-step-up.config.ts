import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for task 1493 (web half — passkey add now
 * requires a fresh step-up). Runs ONLY 1493-passkey-add-step-up.spec.ts
 * against a fully isolated stack the spec's author boots by hand:
 *   - server built from branch fix/1493-passkey-register-server-state-step-up
 *     (worktree ~/code/bb-worktrees/server-1493-e2e), a scratch DB
 *     (bb_1493_e2e), on :3101
 *   - this repo's `bunx vite` on :5273, VITE_API_URL pinned at the :3101 API
 *     (.env.local)
 *
 * No global setup / storageState — each test drives its own fresh account
 * via the dev-only `/dev/auto-login` bypass (`?dev_email=...`), which is
 * exactly the isolation task 1493's brief asked for (own scratch DB, no
 * shared dev API on :3001).
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5273'
const WEB_PORT = new URL(WEB_URL).port

export default defineConfig({
  testDir: '.',
  testMatch: /1493-passkey-add-step-up\.spec\.ts$/,
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    // The spec's author starts this by hand before running the suite
    // (see the task notes) — reuseExistingServer just confirms it's up.
    command: `bunx vite --port ${WEB_PORT} --strictPort`,
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
