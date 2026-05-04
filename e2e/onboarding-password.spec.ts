import { test, expect, type Page } from '@playwright/test'

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

const uniqueEmail = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb-test.io`

/**
 * Drives the signup flow up to the password step (display → verify → password)
 * by reading the generated 12-word recovery phrase out of the DOM, clicking
 * the saved checkbox, and re-typing the words the verify step picks at random.
 */
async function reachPasswordStep(page: Page) {
  // 1) /signup — fill email + accept consent
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await page.getByLabel(/email/i).fill(uniqueEmail())
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /continue/i }).click()

  // 2) /onboarding (display step) — wait for the 12-word phrase to render.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
  const wordEls = page.locator('span.font-mono.text-sm.font-medium')
  await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
  const phraseWords = (await wordEls.allInnerTexts()).map((w) => w.trim())
  expect(phraseWords.length).toBe(12)

  // Acknowledge + continue to verify step
  await page
    .getByRole('checkbox', { name: /I've saved my recovery phrase offline/i })
    .click()
  await page.getByRole('button', { name: /I saved it/i }).click()

  // 3) /onboarding (verify step) — find every "Word #N" input and fill from phrase
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

  // 4) /onboarding (password step) — wait until the password input is in view
  await expect(page.getByPlaceholder('At least 12 characters')).toBeVisible({
    timeout: 5_000,
  })
}

test.describe('Onboarding password step', () => {
  test('shows live strength feedback (weak → fair → strong) and confirm-match (task 0026)', async ({
    page,
  }) => {
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
