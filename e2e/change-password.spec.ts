/**
 * E2E regression test for task 1367 Task 4 — the change-password breach check
 * must go through OUR OWN API (GET /api/v1/auth/pwned-range/{prefix}) and never
 * contact any third-party origin (the old direct api.pwnedpasswords.com call,
 * which was purged once by task 0995 and silently reintroduced by a later
 * change-password commit).
 *
 * Creates its own account via the real /signup → onboarding UI (same pattern
 * as account-deleted.spec.ts's signupAndUnlock) so it has a real OPAQUE
 * password to supply as "current password" — the dev-auto-login bypass
 * account has no OPAQUE password file and cannot exercise this dialog's
 * step-up auth.
 *
 * REQUIRES the isolated e2e harness (`e2e/scripts/web-e2e.sh`) — it is the
 * only backend that seeds the tiny, locally-generated pwned-passwords
 * fixture corpus containing SHA-1('password123456'), so the "breached"
 * branch is exercised end-to-end instead of failing open. Run:
 * `./e2e/scripts/web-e2e.sh e2e/change-password.spec.ts` — no manual env
 * overrides needed. (Task 1520: the harness's pilot-key gate now defaults
 * OFF, matching prod, so signup below no longer needs a pilot key at all —
 * this spec doesn't opt into the gate-ON path.)
 */
import { test, expect, type Page } from '@playwright/test'
import { signupAndUnlock as sharedSignupAndUnlock } from './helpers/signup'

const uniqueEmail = () =>
  `e2e-changepw-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`

const CURRENT_PASSWORD = 'ChangePwCurrent1234'
const BREACHED_NEW_PASSWORD = 'password123456' // seeded into the fixture corpus

/** Full signup flow (email, master key, confirm, password) via the shared helper, landing on `/` with the vault unlocked. */
async function signupAndUnlock(page: Page) {
  await sharedSignupAndUnlock(page, { password: CURRENT_PASSWORD })
}

test.describe('Change password — breach check via our own API (1367)', () => {
  // Fresh, unauthenticated signup — block the dev auto-login bypass so the
  // real /signup UI renders instead of bouncing straight to the drive.
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await context.clearCookies()
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('rejects a breached password and never leaves our origin', async ({ page }) => {
    const foreign: string[] = []
    page.on('request', (r) => {
      const h = new URL(r.url()).host
      if (!/(^|\.)beebeeb\.io$|^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(h)) foreign.push(h)
    })

    await signupAndUnlock(page)

    await page.goto('/settings/security')
    await page.getByRole('button', { name: /^change password$/i }).click()

    const dialog = page.getByRole('dialog', { name: /change password/i })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel(/current password/i).fill(CURRENT_PASSWORD)
    await dialog.getByLabel(/^new password$/i).fill(BREACHED_NEW_PASSWORD)
    await dialog.getByLabel(/confirm new password/i).fill(BREACHED_NEW_PASSWORD)
    await dialog.getByRole('button', { name: /^change password$/i }).click()

    await expect(dialog.getByText(/known data breaches/i)).toBeVisible({ timeout: 15_000 })

    expect(foreign, `unexpected third-party hosts: ${foreign.join(', ')}`).toHaveLength(0)
  })
})
