import { test, expect, type Page } from '@playwright/test'
import { createAccount, fillSignupForm, signupAndUnlock, uniqueEmail } from './helpers/signup'
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
    test.setTimeout(120_000) // the document flow has four steps after the code
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

  const screen = (page: Page) => page.getByTestId('onboarding-screen')

  test('new email: code screen -> verify -> terms -> master key (generated AFTER the ticket) -> password -> drive', async ({
    page,
  }) => {
    const email = uniqueEmail('1525-new')
    await fillSignupForm(page, { email })

    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code', { timeout: 30_000 })
    await expect(page.getByText('Check your email')).toBeVisible()
    // Identical-copy invariant: the subtitle hedges ("If this address can be used") and never asserts
    // existence either way.
    await expect(page.getByText(/If this address can be used/)).toBeVisible()

    // The master key must not exist yet: it is generated ONLY after a valid ticket, never before.
    await expect(page.getByTestId('phrase-words')).toHaveCount(0)

    const code = await waitForSignupCode(email)
    expect(code).toMatch(/^\d{8}$/)
    await page.getByTestId('onboarding-code').fill(code)
    await page.getByRole('button', { name: /^verify$/i }).click()

    await expect(screen(page)).toHaveAttribute('data-screen', 'step:accept_terms', { timeout: 30_000 })
    await expect(page.getByTestId('phrase-words')).toHaveCount(0)
    await page.getByRole('checkbox').nth(0).click()
    await page.getByRole('checkbox').nth(1).click()
    await page.getByTestId('accept-terms-continue').click()

    // Code step cleared and terms accepted -> the master key now renders (12 words).
    await expect(page.getByTestId('phrase-words')).toBeVisible({ timeout: 30_000 })
    const phraseWords: string[] = []
    for (let i = 1; i <= 12; i++) phraseWords.push((await page.getByTestId(`phrase-word-${i}`).innerText()).trim())

    await page.getByRole('checkbox', { name: /I have saved my master key somewhere safe/i }).click()
    await page.getByTestId('phrase-saved').click()
    const inputs = page.locator('[data-testid^="phrase-answer-"]')
    await expect(inputs).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      const id = (await inputs.nth(i).getAttribute('data-testid'))!
      await page.getByTestId(id).fill(phraseWords[Number(id.replace('phrase-answer-', '')) - 1])
    }
    await page.getByRole('button', { name: /^confirm$/i }).click()

    await expect(screen(page)).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
    await createAccount(page, PASSWORD)

    const notNow = page.getByRole('button', { name: /^not now$/i })
    await notNow.waitFor({ state: 'visible', timeout: 20_000 }).then(() => notNow.click()).catch(() => {})
    await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 })
    const openDrive = page.getByTestId('first-files-open-drive')
    await openDrive.waitFor({ state: 'visible', timeout: 4_000 }).then(() => openDrive.click()).catch(() => {})
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('existing email: IDENTICAL check-your-email screen, mail sink gets the sign-in email, master key/password NEVER shown', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail('1525-existing')
    // Create a real account with this email first (full flow: proves a genuine pre-existing account).
    await signupAndUnlock(page, { email, password: PASSWORD })

    // Now try to sign up AGAIN with the same email, as a fresh guest.
    await context.clearCookies()
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await fillSignupForm(page, { email })

    // The SAME screen as the new-email case: no enumeration signal anywhere in the DOM.
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code', { timeout: 30_000 })
    await expect(page.getByText('Check your email')).toBeVisible()
    await expect(page.getByText(/If this address can be used/)).toBeVisible()
    await expect(page.getByText(/already exists/i)).toHaveCount(0)

    const existsEmail = await waitForSignupExistsEmail(email)
    expect(existsEmail.subject).toBe('You already have a Beebeeb account')
    expect(existsEmail.signinUrl).not.toBeNull()
    expect(existsEmail.signinUrl).toContain(`email=${encodeURIComponent(email)}`)
    expect(existsEmail.signinUrl).toContain('/login')

    // No code was sent for this email: no way to reach the master key / password steps from here.
    await page.waitForTimeout(1_000)
    await expect(page.getByTestId('phrase-words')).toHaveCount(0)
    await expect(page.getByTestId('onboarding-password')).toHaveCount(0)
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
  })

  test('wrong code: honest, undifferentiated error — retry with the real code succeeds', async ({ page }) => {
    const email = uniqueEmail('1525-wrongcode')
    await fillSignupForm(page, { email })
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code', { timeout: 30_000 })

    await page.getByTestId('onboarding-code').fill('00000000')
    await page.getByRole('button', { name: /^verify$/i }).click()

    await expect(page.getByTestId('onboarding-error')).toBeVisible({ timeout: 10_000 })
    // Never advanced past the code step.
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
    await expect(page.getByTestId('phrase-words')).toHaveCount(0)

    const code = await waitForSignupCode(email)
    await page.getByTestId('onboarding-code').fill(code)
    await page.getByRole('button', { name: /^verify$/i }).click()
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:accept_terms', { timeout: 30_000 })
  })

  test('"Use a different email" returns to the email step', async ({ page }) => {
    const email = uniqueEmail('1525-wrongemail')
    await fillSignupForm(page, { email })
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code', { timeout: 30_000 })

    await page.getByTestId('use-different-email').click()

    await expect(screen(page)).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 10_000 })
    await expect(page).toHaveURL(/\/signup/)
  })

  test('resend adds a second code without invalidating the first — both verify (server round 3)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const email = uniqueEmail('1525-resend')
    await fillSignupForm(page, { email })
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code', { timeout: 30_000 })

    const firstCode = await waitForSignupCode(email)
    expect(firstCode).toMatch(/^\d{8}$/)

    // The document's resend wait applies before the button appears.
    const again = page.getByRole('button', { name: 'Send a new code' })
    await expect(again).toBeVisible({ timeout: 90_000 })
    await again.click()
    await expect(page.getByText(/a new email is on its way/i)).toBeVisible({ timeout: 10_000 })

    const secondCode = await waitForNewSignupCode(email, firstCode)
    expect(secondCode).toMatch(/^\d{8}$/)
    expect(secondCode).not.toBe(firstCode)

    // The FIRST code, issued before the resend, must STILL verify.
    await page.getByTestId('onboarding-code').fill(firstCode)
    await page.getByRole('button', { name: /^verify$/i }).click()
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:accept_terms', { timeout: 30_000 })
  })
})
