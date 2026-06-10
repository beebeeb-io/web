import { test, expect, type Page } from '@playwright/test'
import crypto from 'crypto'

/**
 * Task 0723 — client-side HIBP breach check in web/OPAQUE onboarding.
 * A known-breached password surfaces a warning (warn-don't-block); a clean one
 * doesn't. HIBP is mocked (deterministic + no live external call): the range
 * endpoint is fulfilled with a CORS header + a body that does/doesn't contain
 * the typed password's SHA-1 suffix.
 */

const uniqueEmail = () =>
  `e2e-breach-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb-test.io`
const sha1Upper = (s: string) => crypto.createHash('sha1').update(s).digest('hex').toUpperCase()

/** Drive signup → recovery-phrase → verify, stopping ON the password step. */
async function reachPasswordStep(page: Page) {
  await page.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup')
  await page.getByLabel(/email/i).fill(uniqueEmail())
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /continue/i }).click()

  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 })
  const wordEls = page.locator('span.font-mono.text-sm.font-medium')
  await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
  const phraseWords = (await wordEls.allInnerTexts()).map((w) => w.trim())
  await page.getByRole('checkbox', { name: /I've saved my recovery phrase offline/i }).click()
  await page.getByRole('button', { name: /I saved it/i }).click()

  const verifyLabels = page.locator('label', { hasText: /^Word #\d+$/ })
  const labelCount = await verifyLabels.count()
  for (let i = 0; i < labelCount; i++) {
    const labelText = (await verifyLabels.nth(i).innerText()).trim()
    const m = labelText.match(/Word #(\d+)/)
    if (!m) throw new Error(`unexpected verify label: ${labelText}`)
    await page.getByLabel(labelText, { exact: true }).fill(phraseWords[parseInt(m[1], 10) - 1])
  }
  await page.getByRole('button', { name: /^verify$/i }).click()
  await expect(page.getByPlaceholder('At least 12 characters')).toBeVisible({ timeout: 10_000 })
}

test.describe('onboarding — HIBP breach warning (0723)', () => {
  test('a breached password surfaces the warning and does NOT block signup', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const pw = 'breached-passphrase-xyz' // ≥12 chars
    const suffix = sha1Upper(pw).slice(5)
    // Requires `https://api.pwnedpasswords.com` in the CSP connect-src — without
    // it the browser blocks the fetch before Playwright can intercept it (this
    // e2e is what proved the CSP gap that would have killed the feature in prod).
    await page.route(/pwnedpasswords\.com\/range\//, (r) =>
      r.fulfill({
        status: 200,
        contentType: 'text/plain',
        headers: { 'access-control-allow-origin': '*' },
        body: `0000000000000000000000000000000000:0\n${suffix}:54321`,
      }))

    await reachPasswordStep(page)
    await page.getByPlaceholder('At least 12 characters').fill(pw)

    const warn = page.getByTestId('password-breach-warning')
    await expect(warn).toBeVisible({ timeout: 10_000 })
    await expect(warn).toContainText('54,321')
    // Warn-don't-block: the Create-account button is enabled once confirm matches.
    await page.getByPlaceholder('Type it again').fill(pw)
    await expect(page.getByRole('button', { name: /create account/i })).toBeEnabled()
    await ctx.close()
  })

  test('a clean password shows no warning', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.route(/pwnedpasswords\.com\/range\//, (r) => r.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1' }))

    await reachPasswordStep(page)
    await page.getByPlaceholder('At least 12 characters').fill('a-unique-strong-passphrase-9182')
    await page.waitForTimeout(1500) // let the debounce + check settle
    await expect(page.getByTestId('password-breach-warning')).toHaveCount(0)
    await ctx.close()
  })
})
