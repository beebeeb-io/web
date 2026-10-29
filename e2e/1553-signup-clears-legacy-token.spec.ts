import { test, expect, type Page } from '@playwright/test'
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
 *   E2E_API_PORT=38141 E2E_VITE_PORT=38142 E2E_DB_NAME=beebeeb_web_e2e_1553b \
 *     ./e2e/scripts/web-e2e.sh e2e/1553-signup-clears-legacy-token.spec.ts
 *
 * Prerequisites: Postgres on 5434 (docker compose), a debug beebeeb-api
 * build matching origin/main (E2E_API_BIN to override).
 *
 * ── PR #109 review round 2 (2026-09-27, Codex P2) ──────────────────────
 * The fix for the original bug (onboarding.tsx's `clearToken()` call) had
 * its own bug: `clearToken()` also fires the registered `onTokenCleared`
 * callback, which `src/lib/api.ts` wires to `clearEmail()` — wiping
 * `bb_email` right after `opaqueRegisterFinish`'s own internal `setEmail()`
 * call just wrote it. The signup account is NOT logging out, so this
 * silently breaks a LATER `VaultUnlock.handlePasskeyUnlock()` call, which
 * reads the account email via `getEmail()`. Fixed by replacing every
 * `clearToken()` call this task added (and login.tsx's three pre-existing
 * ones with the identical latent issue) with a new `clearLegacyBearer()`
 * that drops only the localStorage token, never the email.
 *
 * The extra assertions below prove the ACTUAL regression this review found:
 * bb_email survives signup, and a subsequent vault lock still offers a
 * working passkey-unlock attempt (reaches the real "No passkeys
 * registered" branch, not the pre-fix "Could not determine account email
 * for passkey lookup" dead end) as well as password unlock.
 */

const TEST_PASSWORD = 'LeftoverToken1234'

/** Simulates "the vault just locked" without waiting out the real 60-minute
 *  TTL (see e2e/1532-stay-unlocked-sliding-expiry.spec.ts for the same
 *  concern solved differently there): wipes ONLY the ephemeral
 *  session-persist cache (session-persist.ts's `bb_spt` localStorage key +
 *  its `beebeeb_session_persist` IndexedDB database) while leaving the
 *  password-wrapped vault entry (a SEPARATE IndexedDB database, `beebeeb_vault`
 *  — see vault.ts) and the httpOnly session cookie untouched. After a
 *  reload, key-context.tsx's boot effect finds `hasVault() === true` (so
 *  `vaultExists` stays true) but `restoreCachedKey()` finds nothing (so
 *  `isUnlocked` is false) — exactly what a real TTL expiry produces —
 *  landing ProtectedRoute on `<VaultUnlock/>` rather than `/login`. */
async function lockVault(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.removeItem('bb_spt')
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('beebeeb_session_persist')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })
}

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
    const { email } = await signupAndUnlock(page, { password: TEST_PASSWORD })

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

    // 2b. GATE (a2) — PR #109 review round 2 (Codex P2). bb_email must
    //    SURVIVE the clearLegacyBearer() call onboarding.tsx makes right
    //    after opaqueRegisterFinish (which itself wrote bb_email via its own
    //    internal setEmail()). Before this fix, onboarding.tsx used
    //    clearToken() there, which also fires the registered
    //    onTokenCleared → clearEmail() callback and wiped it immediately.
    const emailAfterSignup = await page.evaluate(() => localStorage.getItem('bb_email'))
    expect(emailAfterSignup).toBe(email)

    // 2c. GATE (c) — the actual regression Codex found: with the account
    //    still fully authenticated (cookie intact), lock the vault (see
    //    lockVault() above) and reload. VaultUnlock must render (not a
    //    redirect to /login — the cookie is untouched), offering BOTH
    //    unlock paths, and passkey unlock must reach the real
    //    "No passkeys registered" branch — which only happens if
    //    VaultUnlock.handlePasskeyUnlock()'s `getEmail()` call succeeds.
    //    Pre-fix, it would immediately hit "Could not determine account
    //    email for passkey lookup" instead, because bb_email was already
    //    gone.
    await lockVault(page)
    await page.reload()

    await expect(page.getByRole('heading', { name: 'Vault locked' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page).not.toHaveURL(/\/login/)

    // Password unlock is still offered.
    const passwordField = page.getByPlaceholder('Your password')
    await expect(passwordField).toBeVisible()

    // Passkey unlock is still offered, and clicking it proves bb_email
    // survived: it must reach listPasskeys() (a real server round trip)
    // rather than dying on the local getEmail() check.
    const passkeyButton = page.getByRole('button', { name: /unlock with passkey/i })
    await expect(passkeyButton).toBeVisible()
    await passkeyButton.click()
    await expect(
      page.getByText('No passkeys registered. Use your password to unlock.'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByText('Could not determine account email for passkey lookup.'),
    ).toHaveCount(0)

    // Finish the flow the normal way — password unlock still works too,
    // landing back on the drive with the account fully usable again.
    await passwordField.fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /^unlock vault$/i }).click()
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 15_000 })

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
