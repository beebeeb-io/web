import { expect, type Page } from '@playwright/test'

/**
 * Shared /signup → /onboarding driving helpers (task 1406).
 *
 * The "Pilot access key" field has been REQUIRED client-side since task 0928
 * (src/pages/signup.tsx: the Continue button is
 * `disabled={!accepted || !email.trim() || !pilotKey.trim()}`) — independent
 * of whether the SERVER enforces the gate (`BB_REQUIRE_PILOT_KEY`). So every
 * spec that drives the real /signup UI must fill this field with SOME
 * non-empty value or the form can never advance past step 1, regardless of
 * the backend's gate state.
 *
 * `PILOT_KEY` matches the isolated e2e harness's default
 * (`e2e/scripts/web-e2e.sh` → `BB_PILOT_SIGNUP_KEY=test-pilot-key`, task
 * 1406) so a spec using the default here passes the server-side check too
 * when the harness's gate is on — not just the client-side non-empty check.
 * Override with `BB_TEST_PILOT_KEY` to point at a different server value, or
 * pass an explicit `pilotKey` to `fillSignupForm`/`signupAndUnlock` (e.g. to
 * exercise the wrong-key rejection path — see e2e/pilot-key-registration.spec.ts).
 */
export const PILOT_KEY = process.env.BB_TEST_PILOT_KEY ?? 'test-pilot-key'

export const uniqueEmail = (prefix = 'e2e'): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`

export interface FillSignupFormOptions {
  email: string
  /** Defaults to PILOT_KEY. Pass an explicit wrong value to test rejection. */
  pilotKey?: string
}

/**
 * Fill and submit the /signup form (email + pilot access key + consent
 * checkbox), landing on /onboarding. Does not assert past the navigation —
 * callers that need to confirm arrival should check the URL themselves (most
 * go straight into `reachPasswordStep`, which asserts it).
 */
export async function fillSignupForm(page: Page, opts: FillSignupFormOptions): Promise<void> {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await page.getByLabel(/email/i).fill(opts.email)
  await page.getByTestId('pilot-key-input').fill(opts.pilotKey ?? PILOT_KEY)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()
}

/**
 * Drive the /onboarding display → verify steps: wait for the generated
 * 12-word recovery phrase to render, capture it, acknowledge it, then
 * re-type the words the verify step asks for. Leaves the page on the
 * password step (its "At least 12 characters" field visible). Returns the
 * captured recovery phrase words in order, for callers that need to restore
 * a vault on a second device later (e.g. cli-auth-redirect.spec.ts).
 */
export async function reachPasswordStep(page: Page): Promise<string[]> {
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
  return phraseWords
}

/**
 * Fill the password step and click "Create account". Does not assert the
 * outcome — a correct pilot key lands on the drive, a rejected one (wrong
 * pilot key, gate on) bounces back to /signup with an inline error; callers
 * assert whichever applies (see signupAndUnlock for the happy path, or
 * pilot-key-registration.spec.ts for the rejection path).
 */
export async function createAccount(page: Page, password: string): Promise<void> {
  const passwordField = page.getByPlaceholder('At least 12 characters')
  await expect(passwordField).toBeVisible({ timeout: 5_000 })
  await passwordField.fill(password)
  await page.getByPlaceholder('Type it again').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
}

export interface SignupAndUnlockOptions {
  /** Defaults to a fresh uniqueEmail(). */
  email?: string
  password: string
  /** Defaults to PILOT_KEY. */
  pilotKey?: string
}

export interface SignedUpAccount {
  email: string
  /** Space-joined 12-word recovery phrase, for restoring the vault on another device. */
  recoveryPhrase: string
}

/**
 * Full signup flow (email → recovery phrase → verify → password), landing on
 * `/` with the vault unlocked. Composes fillSignupForm + reachPasswordStep +
 * createAccount and waits for the drive to render.
 */
export async function signupAndUnlock(
  page: Page,
  opts: SignupAndUnlockOptions,
): Promise<SignedUpAccount> {
  const email = opts.email ?? uniqueEmail()
  await fillSignupForm(page, { email, pilotKey: opts.pilotKey })
  const phraseWords = await reachPasswordStep(page)
  await createAccount(page, opts.password)

  // OPAQUE registration + key wrap can take a few seconds on a cold worker,
  // especially during cargo-watch rebuilds.
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
  await expect(page.getByText(/All files/i).first()).toBeVisible({
    timeout: 10_000,
  })
  return { email, recoveryPhrase: phraseWords.join(' ') }
}
