/**
 * Playwright global setup — authenticates once via the dev auto-login flow
 * and saves browser storage state to playwright/.auth/user.json.
 *
 * Subsequent test files that set storageState: STORAGE_STATE start with the
 * httpOnly `bb_session` cookie already in the context. DevAuthGate re-runs
 * devAutoAuth() on every page load in dev mode, re-caching the vault key in
 * IndexedDB, so the vault is always unlocked without driving the real login UI.
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

export const STORAGE_STATE = path.join(__dirname, '../playwright/.auth/user.json')

setup('authenticate', async ({ page }) => {
  // Navigate to the app — DevAuthGate calls devAutoAuth() on mount
  await page.goto('http://localhost:5173/')

  // Wait for WASM crypto to initialise (DevAuthGate sets data-crypto-ready on body)
  await page.waitForFunction(
    () => document.body.dataset.cryptoReady === 'true',
    { timeout: 15_000 },
  )

  // Wait for the vault to be unlocked and the app to land on the drive
  await page.waitForURL('http://localhost:5173/', { timeout: 10_000 })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5_000 })

  // Verify we're actually authenticated. The dev session token is upgraded to
  // an httpOnly `bb_session` cookie via POST /auth/upgrade-session (task 0447),
  // so it is NOT readable from localStorage/JS anymore — assert on the cookie.
  await expect
    .poll(
      async () => (await page.context().cookies()).some((c) => c.name === 'bb_session'),
      { message: 'devAutoAuth did not establish a bb_session cookie', timeout: 10_000 },
    )
    .toBe(true)

  // Suppress first-run overlays that otherwise mount a full-screen backdrop and
  // intercept pointer events (cookie consent + the onboarding checklist/tour),
  // so authenticated specs can interact with the drive. These are localStorage-
  // backed and captured by storageState below, so every spec inherits a clean,
  // unblocked drive.
  await page.evaluate(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb.onboarding.done', 'true')
  })

  // Persist auth state so tests can reuse it without re-logging in
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })
})
