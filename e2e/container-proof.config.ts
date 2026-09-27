import { defineConfig } from '@playwright/test'

/**
 * Task 1567 ship prep (2026-09-27) — standalone Playwright config for the
 * container-level proof (`container-proof.spec.ts`), run against the REAL
 * built `beebeeb-web` docker image, not the vite dev server and not the
 * shared `playwright.config.ts` project graph.
 *
 * Why standalone: the shared config's "authenticated" project depends on
 * `global.setup.ts`'s `devAutoAuth()`, which is DEV-BUILD-ONLY (stripped
 * from a production `vite build`, same as any other `import.meta.env.DEV`
 * branch) — pointing it at a production-shaped container fails setup
 * outright ("devAutoAuth did not establish a bb_session cookie") and skips
 * every dependent test. This config has no server, no global setup, no
 * storageState — the spec itself drives a REAL signup through the UI
 * (`signupAndUnlock`), exactly like a real first-time user of the shipped
 * image would.
 *
 * Run: E2E_WEB_URL=http://localhost:18099 bunx playwright test --config=e2e/container-proof.config.ts
 * (E2E_WEB_URL must serve the image AND proxy /api, /ws, /health to an
 * isolated API on the same origin — see container-proof.spec.ts's header.)
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:18099'

export default defineConfig({
  testDir: '.',
  testMatch: /container-proof\.spec\.ts$/,
  timeout: 600_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: WEB_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
