import { test, expect } from '@playwright/test'
import { envTestAccount, loginAndProvision } from './helpers/auth'

/**
 * E2E tests for authentication flows.
 *
 * Prerequisites (manual setup required):
 *   1. Postgres running: docker compose -f ../../docker-compose.yml up -d postgres
 *   2. API server:       cd ../server && cargo run -p beebeeb-api
 *   3. Web dev server:   bun dev
 *
 * Run: bunx playwright test
 */

const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`

// API origin for direct signup calls. Under the isolated e2e harness this is the
// dedicated :3003 backend (E2E_API_URL); falls back to the dev :3001 API. Force
// 127.0.0.1 (not localhost) — the API binds IPv4 and Playwright's apiRequestContext
// resolves ::1 first, which the IPv4-only dev API refuses (task 0763).
const API = (process.env.E2E_API_URL ?? 'http://127.0.0.1:3001').replace('://localhost', '://127.0.0.1')

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Block the dev auto-login endpoint so tests start unauthenticated.
    // In dev mode, devAutoAuth() calls /dev/auto-login on every page load —
    // intercepting it with a 404 prevents the automatic session injection.
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))

    // Also clear any existing localStorage auth state
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.context().clearCookies()
    await page.goto('about:blank')
  })
  test('signup flow: fill form, submit, redirected to /onboarding', async ({ page }) => {
    const email = uniqueEmail()

    await page.goto('/signup')
    await expect(page).toHaveURL(/\/signup/)

    // /signup is email + consent only — the password is collected on the
    // /onboarding password step, after the recovery-phrase screens. This
    // test was originally written for an older single-page signup flow;
    // updating it here to match the current shape (closes 0011).
    await page.getByLabel(/email/i).fill(email)
    await page
      .getByRole('checkbox', { name: /Beebeeb cannot recover/i })
      .click()

    // Submit
    await page.getByRole('button', { name: /^continue$/i }).click()

    // Should redirect to onboarding (recovery phrase screen)
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
  })

  test('login flow: fill form, submit, redirected to /', async ({ page }) => {
    // OBSOLETE BY DESIGN (task 0763): this test creates an account via the
    // legacy `/api/v1/auth/signup` (password-only, no OPAQUE password file) and
    // then drives the login UI. The login page is now OPAQUE-mandatory with NO
    // password fallback (src/pages/login.tsx:98 "OPAQUE is mandatory — no
    // fallback path"), so a legacy account can never complete a UI login — it
    // shows "Authentication failed." A real login-to-drive flow requires the
    // full OPAQUE signup UI (recovery phrase + password step), which is already
    // covered by refresh-stability.spec.ts (signupAndUnlock).
    test.skip(true, 'legacy password login removed — app is OPAQUE-mandatory (task 0763); real login covered by refresh-stability.spec.ts')
    const email = uniqueEmail()

    // First, create the account via the API directly. Use 127.0.0.1 rather
    // than `localhost` because Playwright's request context resolves to ::1
    // first and the dev API binds to IPv4 only — the browser's fetch falls
    // back via happy-eyeballs but apiRequestContext does not.
    const signupResp = await page.request.post(`${API}/api/v1/auth/signup`, {
      data: { email, password: 'test-password-12chars!' },
    })
    expect(signupResp.ok()).toBeTruthy()

    // Now test the login UI
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)

    // Selector note: getByLabel(/password/i) also matches the show/hide
    // password toggle button (aria-label "Show password") and gets
    // .first() depending on DOM order. Target the input by placeholder
    // instead — this matches the same pattern used by the 0010 regression
    // test below (closes 0011).
    await page.getByLabel(/email/i).fill(email)
    await page.getByPlaceholder('Your password').fill('test-password-12chars!')

    // The page also has a "Sign in with passkey" button; pick the submit
    // one explicitly. Button label is "Sign in" (task 0763).
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Should redirect to the drive (root page)
    await expect(page).toHaveURL(/^\/$|\/$/,{ timeout: 10_000 })
  })

  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    // Clear any stored session
    await page.context().clearCookies()

    await page.goto('/')

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 })
  })

  test('full OPAQUE + DeviceProvision flow with seeded account', async ({ page }) => {
    const account = envTestAccount()
    test.skip(!account, 'Set BB_TEST_USER_* env vars to run this test (see .env.example)')

    await loginAndProvision(page, account!)

    // After provision, we should be on the drive
    await expect(page).toHaveURL(/^\/(?:$|\?|#)/, { timeout: 10_000 })
  })

  test('wrong-password login surfaces server error, NOT "Session expired" (regression: task 0010)', async ({ page }) => {
    // Regression test for the 401 short-circuit bug. When an UNAUTHENTICATED
    // request hits a 401 (e.g. wrong-password login), the UI must show the
    // server's actual error message — not misleading "Session expired" copy
    // (which only makes sense for an actually-expired session).
    //
    // The login flow first attempts OPAQUE (fails 400), then falls back to
    // legacy `/api/v1/auth/login` which returns 401 with {"error":"unauthorized"}.
    // Pre-fix this surfaced as "Session expired"; post-fix it surfaces "unauthorized".

    // Make sure no stored token leaks in from previous tests — we MUST be
    // unauthenticated for this test to exercise the right code path.
    await page.goto('/login')
    await page.evaluate(() => {
      localStorage.removeItem('bb_session')
    })
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)

    // Wait for the WASM crypto module to be ready — the form blocks otherwise.
    await expect(page.locator('form[data-crypto-ready="true"]')).toBeVisible({ timeout: 15_000 })

    // Submit a wrong-password login against a (likely) non-existent account.
    // Selector note: `getByLabel(/password/i)` also matches the show/hide
    // password toggle button (aria-label "Show password"). Target the actual
    // input by placeholder instead.
    await page.getByLabel(/email/i).fill(`nope-${Date.now()}@beebeeb.io`)
    await page.getByPlaceholder('Your password').fill('definitely-not-the-password-1234')
    // The page also has a "Sign in with passkey" button; pick the submit one explicitly.
    // Button label is "Sign in" (task 0763).
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // The error <p> appears inside the red alert box on the login page.
    // It MUST NOT say "Session expired" — that's the bug — and it should
    // instead surface the API's actual error (or the login page's fallback).
    const errorBox = page.locator('p.text-red, p.text-xs.text-red').first()
    await expect(errorBox).toBeVisible({ timeout: 10_000 })

    const errorText = (await errorBox.textContent())?.toLowerCase().trim() ?? ''
    expect(errorText, 'login error should not pretend the session expired').not.toContain('session expired')

    // Should surface a wrong-credentials message rather than a session-timeout
    // one. The login page is now OPAQUE-mandatory and shows "Authentication
    // failed. Please try again." for a failed handshake (task 0763); older
    // copy ("unauthorized" / "invalid email or password") is still accepted.
    expect(
      /unauthorized|invalid email or password|wrong password|authentication failed/i.test(errorText),
      `expected wrong-credentials copy, got: ${errorText}`,
    ).toBeTruthy()

    // Should still be on /login (not bounced to /login by the session-expired handler).
    await expect(page).toHaveURL(/\/login/)
  })

  test('404 page for unknown routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist')

    // Should show some form of 404 content
    // The app has a NotFound component that renders for unmatched routes
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
    // Page should NOT redirect to login (404 is visible even when not authenticated)
    // or it should show "not found" text
    const url = page.url()
    const hasNotFoundIndicator =
      url.includes('not-found') ||
      url.includes('this-page-does-not-exist') ||
      (body && /not found|404|page.*exist/i.test(body))
    expect(hasNotFoundIndicator).toBeTruthy()
  })
})
