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

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
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
      dependencies: ['setup'],
      use: {
        storageState: STORAGE_STATE,
      },
    },

    // ── Step 2b: tests that must run unauthenticated (login page, etc.) ───────
    {
      name: 'unauthenticated',
      testMatch: /auth\.spec\.ts|login\.spec\.ts/,
      // No storageState — fresh context
    },
  ],
})
