import { test, expect } from '@playwright/test'

/**
 * E2E test for the recovery phrase password reset flow.
 *
 * Verifies the fix for the "Session expired" bug where the client
 * expected `opaque_server_message` from the start endpoint but the
 * server only returns `recovery_token`.
 */

const API = 'http://127.0.0.1:3001'

test.describe('Recovery phrase password reset', () => {
  test.beforeEach(async ({ page }) => {
    // Block the dev auto-login endpoint so we see the real auth pages
    await page.route('**/dev/auto-login', (route) => route.abort())
    // Clear any existing auth state
    await page.goto('/login')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('recovery page loads and shows proper error for invalid phrase (not "Session expired")', async ({ page }) => {
    test.setTimeout(60_000)

    // Create a test account via API so the email exists
    const email = `e2e-recover-${Date.now()}@beebeeb-test.io`
    const signupResp = await page.request.post(`${API}/api/v1/auth/signup`, {
      data: { email, password: 'TestPassword2026!' },
    })
    expect(signupResp.ok()).toBeTruthy()

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

    // We should see a proper error about the phrase being wrong
    // (account was created via legacy signup, has no recovery_check)
    const hasProperError = /does not match|invalid|incorrect|wrong|failed|try again/i.test(bodyText)
    expect(hasProperError).toBe(true)

    console.log('PASS: Recovery shows proper error, not "Session expired"')
  })
})
