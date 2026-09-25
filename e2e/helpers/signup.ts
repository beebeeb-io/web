import { expect, type Page } from '@playwright/test'

/**
 * Shared /signup → /onboarding driving helpers (task 1406).
 *
 * Task 1520: the "Pilot access key" field is NO LONGER shown by default —
 * the server's pilot gate is OFF at launch (BB_REQUIRE_PILOT_KEY=0 on both
 * prod nodes, phase 2) and src/pages/signup.tsx only renders the field (and
 * requires it) after a REAL 403 pilot_key_required bounces the user back
 * from /onboarding with `pilotKeyError` in router state — see
 * src/lib/signup-pilot-gate.ts. So `fillSignupForm` below no longer touches
 * that field at all; it only exists once you're already mid-flow.
 *
 * `PILOT_KEY` matches the isolated e2e harness's default
 * (`e2e/scripts/web-e2e.sh` → `BB_PILOT_SIGNUP_KEY=test-pilot-key`, task
 * 1406). Only relevant when a caller specifically drives the gate-on
 * recovery path via `retrySignupWithPilotKey` (see
 * e2e/pilot-key-registration.spec.ts) — the normal happy-path specs never
 * need it. Override with `BB_TEST_PILOT_KEY` to point at a different server
 * value.
 */
export const PILOT_KEY = process.env.BB_TEST_PILOT_KEY ?? 'test-pilot-key'

export const uniqueEmail = (prefix = 'e2e'): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`

export interface FillSignupFormOptions {
  email: string
}

/**
 * Fill and submit the /signup form (email + consent checkbox), landing on
 * /onboarding. No pilot-key field on a fresh visit (task 1520) — this
 * asserts that. Does not assert past the navigation — callers that need to
 * confirm arrival should check the URL themselves (most go straight into
 * `reachPasswordStep`, which asserts it).
 */
export async function fillSignupForm(page: Page, opts: FillSignupFormOptions): Promise<void> {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await expect(page.getByTestId('pilot-key-input')).toHaveCount(0)
  await page.getByLabel(/email/i).fill(opts.email)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()
}

/**
 * Drives the pilot-gate recovery path: from an ALREADY-bounced-back
 * /signup (onboarding.tsx's 403 pilot_key_required catch handler routed
 * here with `pilotKeyError` in router state, so the field is now visible +
 * required), fill the key and resubmit — lands back on /onboarding with a
 * FRESH mount (a new recovery phrase gets generated; the old one is void).
 * Does not `page.goto()` — that would discard the router state carrying the
 * bounced-back email + error.
 */
export async function retrySignupWithPilotKey(page: Page, pilotKey: string): Promise<void> {
  await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 })
  await expect(page.getByTestId('pilot-key-input')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('pilot-key-input').fill(pilotKey)
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
  await fillSignupForm(page, { email })
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
