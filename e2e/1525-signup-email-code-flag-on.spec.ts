import { test, expect } from '@playwright/test'
import { createAccount, fillSignupForm, reachPasswordStep, uniqueEmail } from './helpers/signup'

/**
 * E2E for task 1525 — BB_SIGNUP_EMAIL_CODE=1 (flag ON): OPAQUE
 * register-start/finish now REQUIRE a valid signup_ticket bound to the
 * email (beebeeb-api/src/routes/opaque_auth.rs). The web client threads
 * the ticket through UNCONDITIONALLY (src/pages/onboarding.tsx — sent
 * whenever one is held, harmless when the server ignores it) — this spec
 * proves the full real-stack signup still reaches the drive under STRICT
 * server-side enforcement, not just when the ticket happens to be optional
 * (1525-signup-email-code.spec.ts covers the flag-off/default harness run).
 *
 * The flag is a server env var, not something a spec can toggle at
 * runtime — run this file with its own harness invocation:
 *   BB_SIGNUP_EMAIL_CODE=1 ./e2e/scripts/web-e2e.sh e2e/1525-signup-email-code-flag-on.spec.ts
 */

test.describe('Signup email code — flag ON enforcement (task 1525)', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await context.clearCookies()
  })

  test('full signup reaches the drive with BB_SIGNUP_EMAIL_CODE=1 enforcing the ticket end to end', async ({
    page,
  }) => {
    const email = uniqueEmail('1525-flagon')
    await fillSignupForm(page, { email })
    // reachPasswordStep transparently clears the code step (reads the real
    // code from the mail sink) — the SAME helper every other signup spec
    // uses, now exercising the strict server-side ticket check instead of
    // the permissive default.
    await reachPasswordStep(page)
    await createAccount(page, 'CorrectHorseBattery9!')

    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })

    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name === 'bb_session')).toBe(true)
  })
})
