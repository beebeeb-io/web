import { defineConfig } from '@playwright/test'

/**
 * Standalone Playwright config for the 1520 no-pilot-key-by-default
 * verification. Runs ONLY 1520-signup-no-pilot-key.spec.ts against a
 * caller-started Vite dev server (no server, no storageState, no global
 * setup) — the spec mocks the entire API itself, mirroring
 * 1517-trial-used-upgrade.config.ts.
 *
 * The caller must start Vite themselves and point E2E_WEB_URL at it, e.g.:
 *   VITE_API_URL=http://127.0.0.1:1 bunx vite --port 5199 --strictPort &
 *   E2E_WEB_URL=http://localhost:5199 \
 *     bunx playwright test --config=e2e/1520-signup-no-pilot-key.config.ts
 * VITE_API_URL is pinned to an unroutable local address (never the prod
 * default in src/lib/api.ts) so any call this spec's page.route mock
 * somehow misses fails closed locally instead of reaching a real origin.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5199'

export default defineConfig({
  testDir: '.',
  testMatch: /1520-signup-no-pilot-key\.spec\.ts$/,
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
