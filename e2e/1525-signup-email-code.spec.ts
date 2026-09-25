import { test, expect } from '@playwright/test'
import { fillSignupForm, signupAndUnlock, uniqueEmail } from './helpers/signup'
import { waitForSignupCode, waitForSignupExistsEmail, waitForNewSignupCode } from './helpers/mail-sink'

/**
 * E2E for task 1525 — verify the email with a code BEFORE the account is
 * created. Drives the real /signup/email-start + /signup/email-verify
 * endpoints against the isolated harness backend (real-stack, no mocks) and
 * reads sent emails back out of the Console-mode mail sink
 * (e2e/helpers/mail-sink.ts — requires RUST_LOG=beebeeb_api::email=info,
 * which e2e/scripts/web-e2e.sh now sets by default).
 *
 * Runs against the harness's DEFAULT backend (BB_SIGNUP_EMAIL_CODE unset,
 * i.e. OFF) — the /signup/email-start and /signup/email-verify ROUTES are
 * unconditionally mounted regardless of that flag (routes/auth.rs's own
 * doc comment: "so the web client can roll out the new screen ahead of the
 * flag flip"), so every test below exercises the real code-screen UI
 * either way. The flag itself only controls whether register-start/finish
 * ENFORCE the ticket — see 1525-signup-email-code-flag-on.spec.ts for that.
 */

const PASSWORD = 'CorrectHorseBattery9!'

test.describe('Signup email verification code (task 1525)', () => {
  test.beforeEach(async ({ page, context }) => {
    // Same pattern as onboarding-password.spec.ts / auth.spec.ts: block the
    // dev auto-login so /signup and /onboarding actually render as a guest.
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await context.clearCookies()
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('new email: code screen -> verify -> recovery phrase (generated AFTER the ticket) -> password -> drive', async ({
    page,
  }) => {
    const email = uniqueEmail('1525-new')
    await fillSignupForm(page, { email })

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
    await expect(page.getByText('Check your inbox')).toBeVisible({ timeout: 10_000 })
    // Identical-copy invariant: the subtitle names the email but hedges
    // ("if <email> can sign up") — never asserts existence either way.
    await expect(page.getByTestId('signup-code-copy')).toContainText('can sign up')
    await expect(page.getByTestId('signup-code-email')).toHaveText(email)

    // Task 1525's core fix: the recovery phrase must not exist yet — it is
    // generated ONLY after a valid ticket, never before.
    await expect(page.locator('span.font-mono.text-sm.font-medium')).toHaveCount(0)

    const code = await waitForSignupCode(email)
    expect(code).toMatch(/^\d{8}$/)
    // Filling all 8 digits auto-submits (mirrors two-factor-prompt.tsx) —
    // no separate "Verify" click: by the time it would land, the step has
    // often already moved on to 'display', racing the button out from
    // under the click.
    await page.getByTestId('signup-code-input').fill(code)

    // Code step cleared -> recovery phrase now renders.
    const wordEls = page.locator('span.font-mono.text-sm.font-medium')
    await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
    const phraseWords = (await wordEls.allInnerTexts()).map((w) => w.trim())

    await page.getByRole('checkbox', { name: /I've saved my recovery phrase offline/i }).click()
    await page.getByRole('button', { name: /I saved it/i }).click()

    const verifyLabels = page.locator('label', { hasText: /^Word #\d+$/ })
    const labelCount = await verifyLabels.count()
    expect(labelCount).toBeGreaterThan(0)
    for (let i = 0; i < labelCount; i++) {
      const labelText = (await verifyLabels.nth(i).innerText()).trim()
      const m = labelText.match(/Word #(\d+)/)
      if (!m) throw new Error(`unexpected verify label: ${labelText}`)
      const wordIdx = parseInt(m[1], 10) - 1
      await page.getByLabel(labelText, { exact: true }).fill(phraseWords[wordIdx])
    }
    await page.getByRole('button', { name: /^verify$/i }).click()

    const passwordField = page.getByPlaceholder('At least 12 characters')
    await expect(passwordField).toBeVisible({ timeout: 5_000 })
    await passwordField.fill(PASSWORD)
    await page.getByPlaceholder('Type it again').fill(PASSWORD)
    await page.getByRole('button', { name: /create account/i }).click()

    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('existing email: IDENTICAL check-your-inbox screen, mail sink gets the sign-in email, phrase/password NEVER shown', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail('1525-existing')
    // Create a real account with this email first (full flow — proves a
    // genuine pre-existing account, not just a challenge row).
    await signupAndUnlock(page, { email, password: PASSWORD })

    // Now try to sign up AGAIN with the same email, as a fresh guest.
    await context.clearCookies()
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await fillSignupForm(page, { email })

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
    // Byte-for-byte the SAME screen as the new-email case — same title,
    // same testids, same copy shape. No enumeration signal anywhere in the
    // DOM: no "this account already exists" text, nothing.
    await expect(page.getByText('Check your inbox')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('signup-code-copy')).toContainText('can sign up')
    await expect(page.getByTestId('signup-code-email')).toHaveText(email)
    await expect(page.getByText(/already have an account/i)).toHaveCount(0)

    const existsEmail = await waitForSignupExistsEmail(email)
    expect(existsEmail.subject).toBe('You already have a Beebeeb account')
    expect(existsEmail.signinUrl).not.toBeNull()
    expect(existsEmail.signinUrl).toContain(`email=${encodeURIComponent(email)}`)
    expect(existsEmail.signinUrl).toContain('/login')

    // No code was ever actually sent for this email — there is no way to
    // reach the phrase/password steps from here. Give the (idle) page a
    // moment, then assert their absence explicitly.
    await page.waitForTimeout(1_000)
    await expect(page.locator('span.font-mono.text-sm.font-medium')).toHaveCount(0)
    await expect(page.getByPlaceholder('At least 12 characters')).toHaveCount(0)
    // Still on /onboarding's code step, not bounced anywhere revealing.
    await expect(page).toHaveURL(/\/onboarding/)
  })

  test('wrong code: honest, undifferentiated error — retry with the real code succeeds', async ({ page }) => {
    const email = uniqueEmail('1525-wrongcode')
    await fillSignupForm(page, { email })
    await expect(page.getByTestId('signup-code-email')).toHaveText(email)

    // Filling 8 digits auto-submits — no separate click (see the new-email
    // test's comment for why a redundant click races the step transition).
    await page.getByTestId('signup-code-input').fill('00000000')

    await expect(page.getByTestId('signup-code-error')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('signup-code-error')).toHaveText(/invalid or expired code/i)
    // Input clears on error so the user can retype cleanly.
    await expect(page.getByTestId('signup-code-input')).toHaveValue('')
    // Never advanced past the code step.
    await expect(page.locator('span.font-mono.text-sm.font-medium')).toHaveCount(0)

    const code = await waitForSignupCode(email)
    await page.getByTestId('signup-code-input').fill(code)

    await expect(page.locator('span.font-mono.text-sm.font-medium')).toHaveCount(12, { timeout: 15_000 })
  })

  test('"Wrong email? Go back" returns to /signup with the email prefilled', async ({ page }) => {
    const email = uniqueEmail('1525-wrongemail')
    await fillSignupForm(page, { email })
    await expect(page.getByTestId('signup-code-email')).toHaveText(email)

    await page.getByRole('button', { name: /wrong email\? go back/i }).click()

    await expect(page).toHaveURL(/\/signup/, { timeout: 10_000 })
    await expect(page.getByLabel(/email/i)).toHaveValue(email)
  })

  test('resend adds a second code without invalidating the first — both verify (server round 3)', async ({
    page,
  }) => {
    const email = uniqueEmail('1525-resend')
    await fillSignupForm(page, { email })
    await expect(page.getByTestId('signup-code-email')).toHaveText(email)

    // Capture the FIRST code explicitly — this is the one we'll prove still
    // works AFTER the resend, not just "a code that verifies".
    const firstCode = await waitForSignupCode(email)
    expect(firstCode).toMatch(/^\d{8}$/)

    await page.getByRole('button', { name: /resend code/i }).click()
    // Honest copy (task 1525 Codex-review follow-up): the button no longer
    // claims a bare "Code resent" — it says what actually happened and that
    // any recent code still works, which is also true of the OLD code below.
    await expect(page.getByText(/we sent a new code/i)).toBeVisible({ timeout: 5_000 })

    // A genuinely DIFFERENT second code must appear — round 3's whole point
    // is that resend ADDS a code rather than replacing (or no-op'ing on) the
    // live one.
    const secondCode = await waitForNewSignupCode(email, firstCode)
    expect(secondCode).toMatch(/^\d{8}$/)
    expect(secondCode).not.toBe(firstCode)

    // The FIRST code — issued before the resend — must STILL verify. This is
    // the core round-3 behavior change under test: a resend must never
    // silently invalidate the code the user might already be looking at in
    // their inbox.
    await page.getByTestId('signup-code-input').fill(firstCode)

    await expect(page.locator('span.font-mono.text-sm.font-medium')).toHaveCount(12, { timeout: 15_000 })
  })
})
