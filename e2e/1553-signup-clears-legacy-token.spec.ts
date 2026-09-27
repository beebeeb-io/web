import { test, expect } from '@playwright/test'
import { signupAndUnlock } from './helpers/signup'

/**
 * E2E regression test for task 1553 — onboarding.tsx's signup flow
 * (opaqueRegisterFinish path) wrote the legacy `bb_session` bearer token to
 * localStorage and never cleared it. login.tsx's password-login path
 * deliberately clears it right after OPAQUE auth succeeds ("server set the
 * bb_session cookie, drop any stale localStorage token so it doesn't get
 * sent as a bearer header that shadows the fresh cookie"); onboarding.tsx
 * skipped that step. A leftover token silently re-authenticates the same
 * account on the next boot via `POST /auth/upgrade-session`
 * (auth-context.tsx's `boot()`) even after the httpOnly session cookie
 * itself is gone — deleting the cookie should actually log the user out.
 *
 * REQUIRES the isolated real-stack e2e harness
 * (`e2e/scripts/web-e2e.sh`) — a real server + fresh Postgres DB, not
 * page.route mocks, since the whole point is to exercise the real
 * register-finish response (Set-Cookie) and the real boot()/upgrade-session
 * migration path. Run:
 *   E2E_API_PORT=38021 E2E_VITE_PORT=38022 E2E_DB_NAME=beebeeb_web_e2e_1553 \
 *     ./e2e/scripts/web-e2e.sh e2e/1553-signup-clears-legacy-token.spec.ts
 *
 * Prerequisites: Postgres on 5434 (docker compose), a debug beebeeb-api
 * build matching origin/main (E2E_API_BIN to override).
 */

const TEST_PASSWORD = 'LeftoverToken1234'

test.describe('Signup no longer leaves a stale bb_session bearer token (1553)', () => {
  // Fresh, unauthenticated signup — block the dev auto-login bypass so the
  // real /signup UI renders instead of bouncing straight to the drive
  // (same pattern as refresh-stability.spec.ts / change-password.spec.ts /
  // onboarding-password.spec.ts).
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await context.clearCookies()
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('after signup, no bb_session in localStorage; deleting the cookie and reloading does NOT silently re-authenticate', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000)

    // 1. Real signup through the actual UI — real OPAQUE registration, real
    //    register-finish round trip, lands unlocked on the drive.
    await signupAndUnlock(page, { password: TEST_PASSWORD })

    // 2. GATE (a) — the leftover-token bug itself. Before the fix,
    //    opaqueRegisterFinish's internal setToken() call left the raw
    //    session token sitting in localStorage under 'bb_session'.
    const tokenAfterSignup = await page.evaluate(() => localStorage.getItem('bb_session'))
    expect(tokenAfterSignup).toBeNull()

    // Sanity: the account DID actually authenticate (cookie-based) — the
    // drive rendered files, and a real bb_session cookie is present. This
    // is what proves gate (a) isn't trivially true because signup silently
    // failed.
    const cookiesAfterSignup = await context.cookies()
    const sessionCookie = cookiesAfterSignup.find((c) => c.name === 'bb_session')
    expect(sessionCookie).toBeDefined()
    expect(sessionCookie?.httpOnly).toBe(true)

    // 3. GATE (b) — delete the httpOnly cookie the way a real "log out this
    //    device" / cookie-clearing action would, then reload. If a stale
    //    bearer token were still sitting in localStorage, auth-context.tsx's
    //    boot() would hand it to POST /auth/upgrade-session, which would
    //    silently mint a BRAND NEW cookie and re-authenticate the user —
    //    exactly the bug this task fixes. dev/auto-login stays blocked
    //    (the route was registered on this `page`, so it persists across
    //    the reload below) so nothing else can silently re-authenticate
    //    either.
    await context.clearCookies()
    await page.reload()

    // Must land on /login — NOT silently re-authenticated back onto the
    // drive.
    await page.waitForURL(/\/login/, { timeout: 15_000 })
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/All files/i)).toHaveCount(0)

    // And no cookie or localStorage token got silently re-minted by the
    // reload itself.
    const cookiesAfterReload = await context.cookies()
    expect(cookiesAfterReload.find((c) => c.name === 'bb_session')).toBeUndefined()
    const tokenAfterReload = await page.evaluate(() => localStorage.getItem('bb_session'))
    expect(tokenAfterReload).toBeNull()
  })
})
