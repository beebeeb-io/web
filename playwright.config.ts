import { defineConfig } from '@playwright/test'
import { config as dotenv } from 'dotenv'
import path from 'path'

/**
 * Playwright E2E test configuration for Beebeeb web client.
 *
 * Prerequisites:
 *   1. docker compose -f ../../docker-compose.yml up -d postgres
 *   2. cd ../server && cargo run -p beebeeb-api
 *   3. bun dev
 *
 * Run all tests:   bunx playwright test
 * Run one file:    bunx playwright test e2e/drive.spec.ts
 * Run setup only:  bunx playwright test e2e/global.setup.ts
 *
 * Auth state is saved to playwright/.auth/user.json by global.setup.ts.
 * Tests in the "authenticated" project reuse it — DevAuthGate re-runs
 * devAutoAuth() on each page load in dev mode, re-caching the vault key
 * in IndexedDB so the vault is always unlocked.
 */
dotenv({ path: '.env.test', override: false })

export const STORAGE_STATE = path.join(__dirname, 'playwright/.auth/user.json')

/** Web origin under test. Defaults to the harness's `bun dev` port (:5173);
 *  override (e.g. E2E_WEB_URL=http://localhost:5174) when the dev server runs
 *  elsewhere — mirrors how E2E_API_URL parameterizes the backend origin. */
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

/** API origin the served app must talk to. Defaults to the local dev API
 *  (:3001). The webServer block below pins this into Vite explicitly so the
 *  app NEVER falls back to its prod default (`https://api.beebeeb.io`, see
 *  src/lib/api.ts) when VITE_API_URL is unset. */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

/** Port Playwright's managed Vite binds — derived from WEB_URL so the
 *  E2E_WEB_URL override stays the single source of truth. */
const WEB_PORT = new URL(WEB_URL).port || '5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Auto-retry transient flakes (occasional slow sync-stream delivery of a
  // freshly-uploaded file's row, network timing). A test that needs >1 attempt
  // still reports as flaky in the summary, so real regressions stay visible.
  retries: 2,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  // ── Deterministic web origin ──────────────────────────────────────────────
  // Boots Vite on the baseURL's port (pinned at the LOCAL API so the served app
  // can never fall back to its prod default) and waits for it before running.
  // Powers the simple `bun run test:e2e` path. `reuseExistingServer: true` makes
  // it cooperate with an already-running origin (a developer's `bun dev`), and
  // the isolated full-stack harness (`e2e/scripts/web-e2e.sh`) sets
  // E2E_NO_WEBSERVER=1 to skip this block entirely — it manages its own Vite+API
  // lifecycle on a fresh per-spec backend. The API is NOT started here; point it
  // via E2E_API_URL (default :3001), which web-e2e.sh / the CI job provision.
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        command: `VITE_API_URL=${API_URL} bunx vite --port ${WEB_PORT} --strictPort`,
        url: WEB_URL,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },

  projects: [
    // ── Step 1: authenticate once and save storage state ──────────────────────
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },

    // ── Step 2a: tests that require a logged-in user ──────────────────────────
    {
      name: 'authenticated',
      testMatch: /\.spec\.ts$/,
      // checkout-redirect-0865.spec.ts, trial-0905.spec.ts, and
      // storage-addon-confirm-0943.spec.ts are all fully self-contained
      // (every API call mocked with page.route, no server needed) and each
      // ships its OWN dedicated config (own timeout) — this project's global
      // test timeout (30s) and global.setup/storageState dependency are both
      // wrong for them (task 1441; task 1449 extended the same defense in
      // depth to the other two). Run each via its own config, e.g.
      // `bunx playwright test --config=e2e/trial-0905.config.ts`.
      // forgot-password-recovery.spec.ts (task 1372 T8): /forgot-password is
      // wrapped in <GuestRoute> (app.tsx) — an authenticated + unlocked
      // session gets redirected away before the page ever renders, so this
      // spec belongs in the unauthenticated project below instead.
      testIgnore: /(checkout-redirect-0865|trial-0905|storage-addon-confirm-0943|checkout-confirmation-resilience-0957|forgot-password-recovery)\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        storageState: STORAGE_STATE,
      },
    },

    // ── Step 2b: tests that must run unauthenticated (login page, etc.) ───────
    {
      name: 'unauthenticated',
      testMatch: /auth\.spec\.ts|login\.spec\.ts|forgot-password-recovery\.spec\.ts/,
      // No storageState — fresh context
    },
  ],
})
