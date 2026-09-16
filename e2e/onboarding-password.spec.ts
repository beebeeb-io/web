import { test, expect } from '@playwright/test'
import { fillSignupForm, reachPasswordStep, uniqueEmail } from './helpers/signup'

/**
 * E2E test for the signup → onboarding password step's live strength feedback.
 *
 * Regression test for task 0026: previously, when a user typed a weak password
 * during signup the form silently refused to submit — no feedback, no error.
 * This test exercises the live feedback states (red "needs more chars" → ink-3
 * "mix in variety" → green "Strong.") and the live confirm-match indicator.
 *
 * Prerequisites (same as auth.spec.ts):
 *   1. Postgres on 5434
 *   2. API on 3001
 *   3. Web dev server on 5173
 */

test.describe('Onboarding password step', () => {
  // This spec drives the real /signup → onboarding flow, so it must run
  // UNauthenticated. In the `authenticated` Playwright project the dev
  // auto-login would bounce /signup to the drive; block it and clear any stored
  // session so the guest signup pages render (task 0763).
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await context.clearCookies()
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('shows live strength feedback (weak → fair → strong) and confirm-match (task 0026)', async ({
    page,
  }) => {
    await fillSignupForm(page, { email: uniqueEmail() })
    await reachPasswordStep(page)

    const passwordField = page.getByPlaceholder('At least 12 characters')
    const confirmField = page.getByPlaceholder('Type it again')
    const createBtn = page.getByRole('button', { name: /create account/i })
    const strengthPanel = page.getByTestId('password-strength')
    const strengthMessage = page.getByTestId('password-strength-message')

    // Initial state: no strength panel until user types
    await expect(strengthPanel).toBeHidden()
    await expect(createBtn).toBeDisabled()

    // --- Too short (5 chars) ---
    await passwordField.fill('abc12')
    await expect(strengthPanel).toBeVisible()
    await expect(strengthMessage).toContainText(/needs at least 12 characters/i)
    await expect(strengthMessage).toContainText(/7 more/i)
    await expect(strengthMessage).toHaveClass(/text-red/)
    await expect(createBtn).toBeDisabled()

    // --- Fair (12 chars, all lowercase, no number) — meets minimum but weak variety ---
    await passwordField.fill('abcdefghijkl')
    await expect(strengthMessage).toContainText(
      /upper.*lowercase|number or symbol/i,
    )
    await expect(strengthMessage).toHaveClass(/text-ink-3/)

    // --- Good (12 chars + mixed case, no digit) ---
    await passwordField.fill('AbcdefghIjkl')
    await expect(strengthMessage).toContainText(/number or symbol/i)
    await expect(strengthMessage).toHaveClass(/text-ink-3/)

    // --- Strong (12+ chars, mixed case, digit) ---
    await passwordField.fill('SecurePass1234')
    await expect(strengthMessage).toHaveText('Strong.')
    await expect(strengthMessage).toHaveClass(/text-green/)

    // Button still disabled because confirm field is empty
    await expect(createBtn).toBeDisabled()

    // --- Confirm mismatch ---
    await confirmField.fill('SecurePass1235')
    await expect(page.getByTestId('confirm-mismatch')).toBeVisible()
    await expect(page.getByTestId('confirm-mismatch')).toContainText(
      /doesn.+match/i,
    )
    await expect(page.getByTestId('confirm-match')).toBeHidden()
    await expect(createBtn).toBeDisabled()

    // --- Confirm match ---
    await confirmField.fill('SecurePass1234')
    await expect(page.getByTestId('confirm-match')).toBeVisible()
    await expect(page.getByTestId('confirm-match')).toHaveText('Match.')
    await expect(page.getByTestId('confirm-mismatch')).toBeHidden()
    await expect(createBtn).toBeEnabled()
  })
})
