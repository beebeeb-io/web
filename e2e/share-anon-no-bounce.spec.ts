import { test, expect } from '@playwright/test'
import fs from 'fs'
import { uploadTextFile, createShareLink } from './helpers/drive'
import { anonymousContext } from './helpers/auth'

/**
 * Task 0741 — anonymous visitors on public routes must NOT bounce to /login.
 *
 * SUITE-TRUST GAP (pinned + FIXED 2026-06-10, task 0740a): the harness appeared
 * to return 200 for anonymous /api/v1/auth/me, masking this whole 401→bounce
 * class. The real mechanism was NOT the server (it 401s a token-less request
 * exactly like prod) — it was the TEST: `browser.newContext()` inherits the
 * `authenticated` project's storageState, so the "anonymous" recipient carried
 * the authed `bb_session` cookie (domain bare `localhost`, port-agnostic). The
 * fix is `anonymousContext()` (explicit empty storageState) — so this spec now
 * exercises the REAL anonymous 401 with NO /auth/me mock (the fidelity proof).
 */
test('anonymous recipient on /s/:token does NOT bounce to /login (prod 401 simulated)', async ({ page, browser }) => {
  test.setTimeout(120_000)

  // Owner (authenticated) creates a real share.
  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  const content = `anon-no-bounce :: ${Date.now()}`
  const filename = `anon-${Date.now()}.txt`
  await uploadTextFile(page, filename, content)
  const shareUrl = await createShareLink(page, filename)

  // TRULY anonymous recipient (task 0740a): empty storageState so the project's
  // authed bb_session cookie isn't inherited, + block /dev/auto-login so the app
  // can't silently re-authenticate via DevAuthGate. The harness then returns the
  // REAL anonymous 401 from the server — no /auth/me mock (the fidelity proof).
  const ctx = await anonymousContext(browser)
  const recipient = await ctx.newPage()
  await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  try {
    await recipient.goto(shareUrl)
    // PRE-FIX: boot getMe()→401 fires fireSessionExpired → navigate('/login').
    // POST-FIX: anonymous 401 doesn't fire + /s/ is public-exempt → share loads.
    await expect(recipient.getByText(filename, { exact: false })).toBeVisible({ timeout: 30_000 })
    await expect(recipient).not.toHaveURL(/\/login/)
    // …and it still decrypts/downloads with NO session.
    const [download] = await Promise.all([
      recipient.waitForEvent('download', { timeout: 30_000 }),
      recipient.getByRole('button', { name: /download and decrypt/i }).click(),
    ])
    expect(fs.readFileSync((await download.path())!, 'utf8')).toBe(content)
  } finally {
    await ctx.close()
  }
})

/**
 * Real session-expiry MUST still gate protected routes: a session-less visitor
 * (here, a logged-in page whose /auth/me starts 401ing) cannot sit on a
 * protected route — ProtectedRoute sends them to /login. This guards against
 * the 0741 fix over-correcting into "401s never redirect".
 */
test('a session-less visitor on a protected route is still sent to /login', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // Session dies: /auth/me now 401s. Reload a protected route.
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }))
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
})
