import { defineConfig } from '@playwright/test'

/**
 * Playwright config for the prod-smoke harness (task 1495).
 *
 * Separate from `playwright.config.ts` on purpose: the prod-smoke suite is a
 * single, ordered, stateful flow (one throwaway account driven end to end
 * through signup → … → delete-account) run by `scripts/prod-smoke.sh`, never
 * by the general `bunx playwright test` sweep — mixing it into the default
 * config's `authenticated`/`setup` projects (dev auto-login, shared
 * storageState) would be wrong for a spec that must never touch dev
 * auto-login and owns its own account/session end to end.
 *
 * The driver (`scripts/prod-smoke.sh`) always manages the target itself —
 * either its own isolated local API + Vite instance, or (lead-only,
 * `--target prod`) production directly — and always sets `E2E_NO_WEBSERVER=1`
 * so this config never tries to also manage a dev server.
 *
 * Run: `./scripts/prod-smoke.sh --target local`
 *  or: `bunx playwright test --config=playwright.prod-smoke.config.ts` once
 *      E2E_WEB_URL / E2E_NO_WEBSERVER / the E2E_CLI_* and E2E_SMOKE_* env vars
 *      below are already set (what the driver does for you).
 */

export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e/prod-smoke',
  testMatch: /\.spec\.ts$/,
  // The whole suite is ONE ordered story against ONE throwaway account —
  // never parallelize, never reorder, never silently retry a step (a retry
  // after e.g. the password changed would resubmit the OLD password and
  // fail for a reason that isn't the bug under test).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['line']],
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
  },
  // Always skipped — the driver script owns the target's lifecycle (its own
  // isolated API+Vite for --target local, or production for --target prod)
  // and always exports E2E_NO_WEBSERVER=1 before invoking Playwright.
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : (() => {
        throw new Error(
          'playwright.prod-smoke.config.ts requires E2E_NO_WEBSERVER=1 — run via scripts/prod-smoke.sh, ' +
            'which manages the target (local isolated stack or production) itself.',
        )
      })(),
})
