import { test, expect, type Page } from '@playwright/test'

/**
 * E2E for task 1404 — the login form must show the exact honest copy for a
 * soft-deleted account: "This account was deleted on <date>. Its encrypted
 * data will be shredded on <date>. We can't recover it." (task 1403's
 * `account_deleted` 403 contract). No generic "wrong password"/"Authentication
 * failed" wording, no stack trace, no raw error code.
 *
 * Depends on server task 1403 (PR #26) being live on the local API — before
 * that lands, the account soft-deletes but login-with-deleted-credentials
 * either succeeds or 401s generically (the exact bug 1403 fixes), so this
 * spec's final assertion will fail until then. That's expected, not a flake.
 *
 * Prerequisites (same as auth.spec.ts / refresh-stability.spec.ts):
 *   1. Postgres on 5434
 *   2. API on 3001 (with server task 1403 merged)
 *   3. Web dev server on 5173
 */

const uniqueEmail = () =>
  `e2e-1404-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`

const TEST_PASSWORD = 'AccountDeleted1234'

/**
 * Full signup flow (email → recovery phrase → verify → password), landing on
 * `/` with the vault unlocked. Mirrors refresh-stability.spec.ts's
 * signupAndUnlock — duplicated locally (not imported) to keep this spec
 * self-contained per the existing convention in this e2e suite (auth.spec.ts
 * and refresh-stability.spec.ts each carry their own copy).
 */
async function signupAndUnlock(page: Page, email: string) {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await page.getByLabel(/email/i).fill(email)
  // Private-development pilot gate (added after refresh-stability.spec.ts's
  // signupAndUnlock was written — that spec is presumably now stale too).
  // The field is unconditionally required client-side regardless of whether
  // the server enforces it (BB_REQUIRE_PILOT_KEY, off in this local .env) —
  // any non-empty value satisfies both.
  await page.getByLabel(/pilot access key/i).fill('e2e-test-key')
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
  await passwordField.fill(TEST_PASSWORD)
  await page.getByPlaceholder('Type it again').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()

  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
  await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })
}

/**
 * Delete the just-signed-up account via the real /settings/delete-account
 * UI: type DELETE, check the encrypted-data-cannot-be-recovered box, confirm
 * identity with the account's password (StepUpAuth's OPAQUE re-auth), submit.
 * Resolves once redirected to /login (delete-account.tsx's success path).
 */
async function deleteAccountViaUi(page: Page) {
  await page.goto('/settings/delete-account')
  await expect(page.getByText(/Delete your account/i)).toBeVisible({ timeout: 10_000 })

  await page.getByPlaceholder('DELETE').fill('DELETE')
  await page
    .getByRole('checkbox', { name: /files are encrypted and cannot be recovered/i })
    .click()

  await page.getByRole('button', { name: /^delete permanently$/i }).click()

  // StepUpAuth modal — re-confirm identity with the account password.
  await expect(page.getByRole('dialog', { name: /confirm your identity/i })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /^delete account$/i }).click()

  // delete-account.tsx navigates('/login', {replace: true}) on success.
  await page.waitForURL(/\/login/, { timeout: 15_000 })

  // KNOWN pre-existing bug (found while building this spec, unrelated to
  // task 1404): delete-account.tsx's success path never clears AuthContext's
  // `user` or the vault's `isUnlocked` state before navigating. GuestRoute
  // (app.tsx) redirects `/login` back to `/` whenever `user && isUnlocked`
  // are BOTH still truthy, so in-app SPA navigation bounces straight back to
  // a stale drive view (server session is actually already dead — only the
  // client's in-memory state is stale). A real user hitting this either
  // reloads or waits for the next failed authenticated call's global 401
  // handler to sort it out. Force that here with a hard navigation, which
  // re-runs AuthProvider's boot() from a clean slate.
  await page.goto('/login')
}

test.describe('account_deleted login copy (task 1404)', () => {
  // Fresh, unauthenticated context per test (mirrors auth.spec.ts) — this
  // spec creates + deletes a real account via the UI, not a fixture.
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  })

  test('logging back in with a deleted account shows the exact deletion copy', async ({
    page,
  }) => {
    const email = uniqueEmail()

    await signupAndUnlock(page, email)
    await deleteAccountViaUi(page)

    // Now on /login (fresh from the delete redirect) — attempt to log back
    // in with the SAME credentials. Task 1403: this must be REJECTED with
    // the typed account_deleted 403, not a normal login.
    await expect(page).toHaveURL(/\/login/)
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 15_000 })

    await page.getByLabel(/email/i).fill(email)
    await page.getByPlaceholder('Your password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    const errorBox = page.locator('p.text-red, p.text-xs.text-red').first()
    await expect(errorBox).toBeVisible({ timeout: 10_000 })

    // Verification evidence (task 1404) — the login form showing the exact
    // deletion copy, for docs/_qa-evidence/1404/.
    await page.screenshot({ path: 'test-results/1404-account-deleted-login.png', fullPage: false })

    const errorText = (await errorBox.textContent())?.trim() ?? ''

    // Exact brand copy — both sentences, both clauses. Not a substring probe:
    // this is literally the string task 1404's acceptance criteria specify.
    expect(errorText).toMatch(/^This account was deleted on .+\./)
    expect(errorText).toContain('Its encrypted data will be shredded on')
    expect(errorText).toMatch(/We can.t recover it\.$/)

    // Must NOT be the generic wrong-credentials/session-expired copy this
    // replaces, and must never leak the raw machine code or a stack frame.
    expect(errorText.toLowerCase()).not.toContain('authentication failed')
    expect(errorText.toLowerCase()).not.toContain('session expired')
    expect(errorText).not.toContain('account_deleted')
    expect(errorText).not.toContain('{')

    // Still on /login — a deleted account must never reach the drive.
    await expect(page).toHaveURL(/\/login/)
  })
})
