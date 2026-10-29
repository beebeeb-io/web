import { test, expect } from '@playwright/test'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'

/**
 * E2E test for the recovery phrase password reset flow.
 *
 * Verifies the fix for the "Session expired" bug where the client
 * expected `opaque_server_message` from the start endpoint but the
 * server only returns `recovery_token`.
 *
 * Runs on the isolated e2e harness (task 1466): `./e2e/scripts/web-e2e.sh
 * e2e/recovery-phrase.spec.ts` — no manual env overrides needed.
 *
 * Task 1799: the account is created through the real signup UI (OPAQUE
 * register, recovery phrase + `recovery_check`), not the retired legacy
 * password signup route. Because the account is real, the wrong phrase is
 * now rejected by the recovery_check comparison — the same user-facing error
 * the legacy account (which had no recovery_check) produced.
 */

test.describe('Recovery phrase password reset', () => {
  test.beforeEach(async ({ page, context }) => {
    // Block the dev auto-login endpoint so we see the real auth pages
    await page.route('**/dev/auto-login', (route) => route.abort())
    // Clear any existing auth state (cookie session included, task 1799)
    await context.clearCookies()
    await page.goto('/login')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('recovery page loads and shows proper error for invalid phrase (not "Session expired")', async ({ page }) => {
    test.setTimeout(60_000)

    // Create a real account through the signup UI so the email exists, then
    // drop the session so /recover-with-phrase is reached signed out.
    const email = uniqueEmail('e2e-recover')
    await signupAndUnlock(page, { email, password: 'TestPassword2026!' })
    await page.context().clearCookies()
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })

    // Navigate to recovery page
    await page.goto('/recover-with-phrase')
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 20_000 })

    // Take a screenshot to see what we have
    await page.screenshot({ path: '../../qa-screenshots/recovery-phrase-page-loaded.png' })

    // Find and fill the email field
    const emailInput = page.locator('input[type="email"], input[placeholder*="mail"], input[name="email"]').first()
    await expect(emailInput).toBeVisible({ timeout: 5_000 })
    await emailInput.fill(email)

    // Find and fill the phrase input
    const phraseInput = page.locator('textarea, input[placeholder*="phrase"], input[name*="phrase"]').first()
    await expect(phraseInput).toBeVisible({ timeout: 5_000 })
    await phraseInput.fill('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')

    // Submit step 1
    const submitButton = page.getByRole('button', { name: /verify|continue|next|recover|submit|reset/i })
    await expect(submitButton).toBeVisible({ timeout: 3_000 })
    await submitButton.click()

    // Wait for server response
    await page.waitForTimeout(5000)

    // Take screenshot of result
    await page.screenshot({ path: '../../qa-screenshots/recovery-phrase-after-submit.png' })

    // The KEY assertion: "Session expired" should NEVER appear
    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('session expired')

    // We should see a proper error about the phrase being wrong (the account's
    // recovery_check does not match the phrase submitted). Current copy is
    // "The recovery phrase doesn't match this account." — match the contraction
    // ("doesn't") as well as the older "does not" wording (task 0763).
    const hasProperError = /does ?n.t match|doesn't match|invalid|incorrect|wrong|failed|try again/i.test(bodyText)
    expect(hasProperError).toBe(true)

    console.log('PASS: Recovery shows proper error, not "Session expired"')
  })
})
