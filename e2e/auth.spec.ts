import { test, expect } from '@playwright/test'
import { envTestAccount, loginAndProvision } from './helpers/auth'
import { fillSignupForm } from './helpers/signup'

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

test.describe('Authentication', () => {
  // Override the [authenticated] project's storageState for ALL tests in this
  // describe block. Every test here manages auth state manually via beforeEach
  // and needs to start with a blank cookie jar, not the saved dev session.
  // Without this override, the [authenticated] project loads a valid bb_session
  // cookie for the isolated :3003 backend — getMe() succeeds even after
  // clearCookies() in beforeEach because the server-side session is still live
  // on the test DB, so unauthenticated tests falsely pass as authenticated.
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }) => {
    // Block the dev auto-login endpoint so tests start unauthenticated.
    // In dev mode, devAutoAuth() calls /dev/auto-login on every page load —
    // intercepting it with a 404 prevents the automatic session injection.
    //
    // The route intercept is registered before any navigation and persists for
    // the page lifetime. No prior navigation is needed — test.use() above
    // already ensures each test starts with a blank context (no cookies, no
    // localStorage), so there is no prior-session state to clear.
    //
    // NOTE: a prior version of this beforeEach also navigated to
    // http://localhost:5173 to explicitly clear state, but that pre-navigation
    // triggered a getMe() call on EVERY test, contributing to the auth rate
    // limiter (60 req/60s per IP). In auth.spec.ts with 6 tests across two
    // projects (+ setup + retries), the cumulative requests pushed getMe() into
    // 429 territory, causing auth.boot() to block on Retry-After delays (api.ts
    // retries 429 up to 3x). When boot() stalled, ProtectedRoute never got
    // user=null + loading=false, so the redirect to /login never fired.
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  })
  test('signup flow: fill form, submit, redirected to /onboarding', async ({ page }) => {
    const email = uniqueEmail()

    // /signup is email + consent — the password is collected on the
    // /onboarding password step, after the recovery-phrase screens. This
    // test was originally written for an older single-page signup flow;
    // updating it here to match the current shape (closes 0011). No pilot
    // access key field by default since task 1520 (server gate is OFF at
    // launch; fillSignupForm asserts the field is absent).
    await fillSignupForm(page, { email })

    // Should redirect to onboarding (recovery phrase screen)
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
  })

  // Task 1799: the old 'login flow' test here created its account through the
  // legacy password-only signup route (no OPAQUE password file) and
  // had been `test.skip`ped since task 0763 (the login page is OPAQUE-mandatory,
  // so such an account can never complete a UI login). The legacy route is being
  // retired, so the dead test is gone rather than ported. A real signup -> drive
  // -> reload -> login-to-drive flow is covered by refresh-stability.spec.ts
  // (signupAndUnlock) and the seeded-account test below.

  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
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
