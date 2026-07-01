/**
 * Playwright global setup — authenticates once via the dev auto-login flow
 * and saves browser storage state to playwright/.auth/user.json.
 *
 * Subsequent test files that set storageState: STORAGE_STATE start with the
 * httpOnly `bb_session` cookie already in the context. DevAuthGate re-runs
 * devAutoAuth() on every page load in dev mode, re-caching the vault key in
 * IndexedDB, so the vault is always unlocked without driving the real login UI.
 */
import { test as setup, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

export const STORAGE_STATE = path.join(__dirname, '../playwright/.auth/user.json')

/** API origin the app talks to — the isolated e2e backend (:3003) sets
 *  E2E_API_URL; falls back to the default dev API (:3001). */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

/** Web origin under test — defaults to the harness's `bun dev` port (:5173);
 *  E2E_WEB_URL overrides it (kept in lockstep with playwright.config WEB_URL). */
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

/** Mark the welcome-tour preference seen SERVER-SIDE so the full-screen
 *  checklist (which opens whenever the server pref lacks seen:true) never
 *  mounts its click-blocking backdrop. Uses the page's authenticated cookies.
 *
 *  `page.request` does not reliably auto-attach the context's `bb_session`
 *  cookie when the API origin's port differs from the page's (e.g. the
 *  isolated harness's :3003 API vs :5173 web dev server) — same cross-port
 *  gap `bundle-share.spec.ts` already works around: read the cookie from the
 *  context and pass it explicitly rather than relying on automatic reuse. */
export async function setWelcomeTourSeen(page: Page): Promise<void> {
  const sessionCookie = (await page.context().cookies()).find((c) => c.name === 'bb_session')
  if (!sessionCookie) {
    throw new Error('bb_session cookie not present on page context before setWelcomeTourSeen')
  }
  const res = await page.request.put(`${API_URL}/api/v1/preferences/welcome_tour`, {
    data: { seen: true, completed: [] },
    headers: { Cookie: `bb_session=${sessionCookie.value}` },
  })
  if (!res.ok()) {
    throw new Error(`failed to set welcome_tour preference: ${res.status()} ${await res.text()}`)
  }
}

setup('authenticate', async ({ page }) => {
  // Navigate to the app — DevAuthGate calls devAutoAuth() on mount
  await page.goto(`${WEB_URL}/`)

  // Wait for WASM crypto to initialise (DevAuthGate sets data-crypto-ready on body)
  await page.waitForFunction(
    () => document.body.dataset.cryptoReady === 'true',
    { timeout: 15_000 },
  )

  // Wait for the vault to be unlocked and the app to land on the drive
  await page.waitForURL(`${WEB_URL}/`, { timeout: 10_000 })
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

  // Suppress first-run overlays that mount a full-screen backdrop and intercept
  // pointer events, so authenticated specs can interact with the drive:
  //  - cookie consent          → localStorage `bb_cookie_consent`
  //  - onboarding guide (chip)  → localStorage `beebeeb_onboarding_state={"step":"done"}`
  //  - welcome tour (checklist) → SERVER preference `welcome_tour={seen:true}`
  //    (the checklist opens whenever the server pref lacks seen:true — a fresh
  //    account 404s, so localStorage alone is NOT enough; it must be set server-
  //    side via the authenticated cookie).
  await page.evaluate(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
  })
  await setWelcomeTourSeen(page)

  // Persist auth state so tests can reuse it without re-logging in
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })
})
