/**
 * E2E regression test for task 1367 Task 4 — the change-password breach check
 * must go through OUR OWN API (GET /api/v1/auth/pwned-range/{prefix}) and never
 * contact any third-party origin (the old direct api.pwnedpasswords.com call,
 * which was purged once by task 0995 and silently reintroduced by a later
 * change-password commit).
 *
 * Creates its own account via the real /signup → onboarding UI (same pattern
 * as account-deleted.spec.ts's signupAndUnlock — the newer, pilot-gate-aware
 * version; refresh-stability.spec.ts's copy predates that gate and is stale)
 * so it has a real OPAQUE password to supply as "current password" — the
 * dev-auto-login bypass account has no OPAQUE password file and cannot
 * exercise this dialog's step-up auth.
 *
 * REQUIRES the isolated e2e harness (`e2e/scripts/web-e2e.sh`) — it is the
 * only backend that both (a) seeds the tiny, locally-generated pwned-
 * passwords fixture corpus containing SHA-1('password123456'), so the
 * "breached" branch is exercised end-to-end instead of failing open, and
 * (b) enables the pilot-key gate (`BB_REQUIRE_PILOT_KEY=1`) that the signup
 * flow below must satisfy. Run: `./e2e/scripts/web-e2e.sh e2e/change-password.spec.ts`
 * — no manual env overrides needed; the pilot key this spec types
 * (`PILOT_KEY` from `./helpers/signup`, env `BB_TEST_PILOT_KEY`) is kept in
 * lockstep with the harness's own default (task 1466).
 */
import { test, expect, type Page } from '@playwright/test'
import { PILOT_KEY } from './helpers/signup'

const uniqueEmail = () =>
  `e2e-changepw-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`

const CURRENT_PASSWORD = 'ChangePwCurrent1234'
const BREACHED_NEW_PASSWORD = 'password123456' // seeded into the fixture corpus

/**
 * Drive the full signup flow (email → recovery phrase → verify → password)
 * and land on `/` with the vault unlocked. Mirrors
 * refresh-stability.spec.ts's signupAndUnlock — duplicated here (not shared)
 * to keep this spec self-contained per this suite's existing convention.
 */
async function signupAndUnlock(page: Page): Promise<void> {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await page.getByLabel(/email/i).fill(uniqueEmail())
  // Pilot-access-key gate — required client-side unconditionally (task 0928)
  // AND server-side when the isolated harness's gate is on (task 1406/1411).
  // MUST match the harness's BB_PILOT_SIGNUP_KEY — imported from the shared
  // helper (single source of truth, task 1466) rather than hardcoded here.
  await page.getByLabel(/pilot access key/i).fill(PILOT_KEY)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()

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

  const passwordField = page.getByPlaceholder('At least 12 characters')
  await expect(passwordField).toBeVisible({ timeout: 5_000 })
  await passwordField.fill(CURRENT_PASSWORD)
  await page.getByPlaceholder('Type it again').fill(CURRENT_PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()

  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
  await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })
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
