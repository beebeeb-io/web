import { defineConfig } from '@playwright/test'

/**
 * Task 1943 — the two-origin v1 compatibility rung (e2e/1943-v1-compat.spec.ts).
 *
 * Self-contained: no global setup, no shared storage state and no managed
 * webServer. The spec drives TWO already-running web origins against ONE API
 * (see the spec header for the stack). Run:
 *   E2E_1943_BASE_URL=http://localhost:38432 E2E_1943_BRANCH_URL=http://localhost:38433 \
 *   E2E_1943_API_URL=http://localhost:38431 \
 *   bunx playwright test --config=e2e/1943-v1-compat.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: /1943-v1-compat\.spec\.ts$/,
  timeout: 600_000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 60_000,
  },
})
