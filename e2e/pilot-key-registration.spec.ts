import { test, expect, type Page } from '@playwright/test'

/**
 * E2E regression test for task 1411.
 *
 * With the server's pilot signup gate ON (`BB_REQUIRE_PILOT_KEY=1`,
 * `BB_PILOT_SIGNUP_KEY=<key>`), the pilot access key must ride on EVERY
 * registration request — `opaque/register-start` AND `opaque/register-finish`
 * (both are re-checked server-side, `beebeeb-api/src/routes/opaque_auth.rs`).
 * Before the fix, `opaqueRegisterFinish` never sent the header, so the final
 * "Create account" call 403'd with `pilot_key_required` AFTER the user had
 * already generated + verified their recovery phrase and set a password.
 *
 * This spec must run against a LOCAL API started with the gate ON, e.g.:
 *   BB_REQUIRE_PILOT_KEY=1 BB_PILOT_SIGNUP_KEY=test-pilot-key cargo run -p beebeeb-api
 * (a fresh DB, so email-uniqueness/rate limits don't collide with other runs).
 * Point Playwright at it explicitly if it isn't on the default :3001/:5173, e.g.:
 *   E2E_API_URL=http://localhost:3011 E2E_WEB_URL=http://localhost:5183 \
 *     bunx playwright test e2e/pilot-key-registration.spec.ts
 * Set BB_TEST_PILOT_KEY to override the expected-correct key (defaults to
 * 'test-pilot-key', matching the value above).
 */

const PILOT_KEY = process.env.BB_TEST_PILOT_KEY ?? 'test-pilot-key'
const uniqueEmail = () =>
  `e2e-pilot-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`
const PASSWORD = 'CorrectHorseBattery9!'

async function fillSignupForm(page: Page, email: string, pilotKey: string) {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await page.getByLabel(/email/i).fill(email)
  await page.getByTestId('pilot-key-input').fill(pilotKey)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()
}

/**
 * Drives display -> verify -> password steps on /onboarding, reading the
 * generated 12-word recovery phrase out of the DOM and re-typing the words
 * the verify step asks for. Mirrors the helper in onboarding-password.spec.ts.
 */
async function reachPasswordStep(page: Page) {
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
  const wordEls = page.locator('span.font-mono.text-sm.font-medium')
  await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
  const phraseWords = (await wordEls.allInnerTexts()).map((w) => w.trim())
  expect(phraseWords.length).toBe(12)

  await page
    .getByRole('checkbox', { name: /I've saved my recovery phrase offline/i })
    .click()
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

  await expect(page.getByPlaceholder('At least 12 characters')).toBeVisible({
    timeout: 5_000,
  })
}

test.describe('Pilot key gate — full registration flow (task 1411)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  })

  test('correct pilot key: full sign-up (recovery phrase -> verify -> password -> Create account) lands in the vault', async ({
    page,
  }) => {
    const email = uniqueEmail()
    await fillSignupForm(page, email, PILOT_KEY)
    await reachPasswordStep(page)

    await page.getByPlaceholder('At least 12 characters').fill(PASSWORD)
    await page.getByPlaceholder('Type it again').fill(PASSWORD)
    await page.getByRole('button', { name: /create account/i }).click()

    // Reaching the drive proves BOTH register-start AND register-finish
    // succeeded with the pilot key attached — the exact regression this test
    // guards (pre-fix, register-finish 403'd here with pilot_key_required).
    // toHaveURL matches against the FULL url (origin + path), not just the
    // path — match "/" at the end of the origin, optionally followed by a
    // query/hash, rather than anchoring on a bare leading "/".
    await expect(page).toHaveURL(/\/(?:$|\?|#)/, { timeout: 20_000 })
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
      .toBe('/')

    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name === 'bb_session')).toBe(true)
  })

  test('wrong pilot key: registration is rejected with the typed message and the account is never created', async ({
    page,
  }) => {
    const email = uniqueEmail()
    await fillSignupForm(page, email, 'definitely-the-wrong-key')
    await reachPasswordStep(page)

    await page.getByPlaceholder('At least 12 characters').fill(PASSWORD)
    await page.getByPlaceholder('Type it again').fill(PASSWORD)
    await page.getByRole('button', { name: /create account/i }).click()

    // Bounced back to /signup with the server's typed pilot-key error inline
    // next to the key field (onboarding.tsx's 403 pilot_key_required handler).
    await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 })
    const pilotError = page
      .locator('p')
      .filter({ hasText: /pilot access key|private development/i })
    await expect(pilotError.first()).toBeVisible({ timeout: 5_000 })

    // Never authenticated, never reached the drive — no account was created.
    expect(new URL(page.url()).pathname).not.toBe('/')
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name === 'bb_session')).toBe(false)
  })
})
