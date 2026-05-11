/**
 * Playwright global setup — authenticates once via the dev auto-login flow
 * and saves browser storage state to playwright/.auth/user.json.
 *
 * Subsequent test files that set storageState: STORAGE_STATE start with
 * bb_session already in localStorage. DevAuthGate re-runs devAutoAuth() on
 * every page load in dev mode, re-caching the vault key in IndexedDB, so
 * the vault is always unlocked without needing to drive the real login UI.
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

  // Verify we're actually authenticated (bb_session in localStorage)
  const session = await page.evaluate(() => localStorage.getItem('bb_session'))
  if (!session) throw new Error('devAutoAuth did not produce a session token')

  // Persist auth state so tests can reuse it without re-logging in
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })
})
