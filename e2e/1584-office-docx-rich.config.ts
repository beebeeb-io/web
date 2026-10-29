/**
 * Task 1584 — own Playwright config for e2e/1584-office-docx-rich.spec.ts
 * (auto-picked by e2e/scripts/web-e2e.sh's `<spec>.config.ts` sibling rule).
 *
 * Why its own config: the default config runs Chromium desktop only. Guus's
 * report was iPhone Safari, so this spec runs the SAME tests in three
 * projects — Chromium desktop, WebKit with the iPhone 15 descriptor
 * (portrait) and WebKit iPhone 15 landscape. Everything else (webServer,
 * baseURL, the setup project + storageState) is the default config's.
 */
import { defineConfig, devices } from '@playwright/test'
import base, { STORAGE_STATE } from '../playwright.config'

const iphone = devices['iPhone 15']

/** Optional comma-separated project filter (E2E_1584_PROJECTS=webkit-iphone-portrait)
 *  so one harness run fits a single foreground call. Unset = all three. */
const only = process.env.E2E_1584_PROJECTS?.split(',').map((s) => s.trim()).filter(Boolean)

export default defineConfig({
  ...base,
  // Relative paths in a config resolve against THAT config's directory; the
  // base's './e2e' would point at e2e/e2e from here.
  testDir: '.',
  timeout: 300_000,
  // A real engine boot per test; a retry would hide a flaky boot, not fix it.
  retries: 0,
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium-desktop',
      testMatch: /1584-office-docx-rich\.spec\.ts$/,
      dependencies: ['setup'],
      use: { browserName: 'chromium', storageState: STORAGE_STATE, viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit-iphone-portrait',
      testMatch: /1584-office-docx-rich\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...iphone, storageState: STORAGE_STATE },
    },
    {
      name: 'webkit-iphone-landscape',
      testMatch: /1584-office-docx-rich\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...iphone,
        viewport: { width: iphone.viewport.height, height: iphone.viewport.width },
        storageState: STORAGE_STATE,
      },
    },
  ].filter((p) => p.name === 'setup' || !only || only.includes(p.name)),
})
