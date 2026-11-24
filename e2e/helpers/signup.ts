// Signup E2E helpers: unique email, form fill, pilot-key retry, password step.
import { expect, type Page } from '@playwright/test'
import { waitForSignupCode } from './mail-sink'

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
 * Fill and submit the document-driven /signup email step (the live flow: FEATURE_ONBOARDING_DOCUMENT is on by
 * default). No pilot-key field on a fresh visit (task 1520). The terms checkboxes come later, on their own step
 * (see `reachPasswordStep`). Does not assert past the click.
 */
/** The address each page signed up with: the code step does not show it, the mail sink needs it. */
const signupEmails = new WeakMap<Page, string>()

export async function fillSignupForm(page: Page, opts: FillSignupFormOptions): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('bb_cookie_consent', 'all'))
  await page.goto('/signup?nodev=1')
  await expect(page).toHaveURL(/\/signup/)
  await expect(page.getByTestId('onboarding-screen')).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 30_000 })
  await expect(page.getByTestId('pilot-key-input')).toHaveCount(0)
  signupEmails.set(page, opts.email)
  await page.getByTestId('onboarding-email').fill(opts.email)
  await page.getByRole('button', { name: /^continue$/i }).click()
}

/**
 * Drives the pilot-gate recovery path: from an ALREADY-bounced-back
 * /signup (onboarding.tsx's 403 pilot_key_required catch handler routed
 * here with `pilotKeyError` in router state, so the field is now visible +
 * required), fill the key and resubmit — lands back on /onboarding with a
 * FRESH mount (a new master key gets generated; the old one is void).
 * Does not `page.goto()` — that would discard the router state carrying the
 * bounced-back email + error.
 */
export async function retrySignupWithPilotKey(page: Page, pilotKey: string): Promise<void> {
  await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 })
  await expect(page.getByTestId('pilot-key-input')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('pilot-key-input').fill(pilotKey)
  // The bounce-back is a fresh /signup mount: the "can't recover" acknowledgement
  // starts unchecked again (the email + key survive via router state), so a real
  // user re-ticks it before Continue is enabled — do the same here.
  const ack = page.getByRole('checkbox', { name: /Beebeeb can.?t recover/i })
  if (!(await ack.isChecked())) await ack.click()
  await page.getByRole('button', { name: /^continue$/i }).click()
}

/**
 * Drive the document-driven sign-up from the code step to the password step, in the order of the document:
 * email code (read back out of the mail sink, e2e/helpers/mail-sink.ts), terms, then the MASTER KEY first (the
 * 12 words, "I have saved my master key" box, confirm 3 words), and stop on the password step. Returns the 12
 * words in order, for callers that restore the vault on a second device later.
 *
 * Needs a mail sink: the API log (RUST_LOG=beebeeb_api::email=info, e2e/scripts/web-e2e.sh) or Mailpit
 * (E2E_MAILPIT_URL).
 */
export async function reachPasswordStep(page: Page): Promise<string[]> {
  const screen = page.getByTestId('onboarding-screen')
  await expect(screen).toHaveAttribute('data-screen', 'step:verify_email_code', { timeout: 30_000 })
  const email = signupEmails.get(page)
  if (!email) throw new Error('reachPasswordStep: call fillSignupForm(page, { email }) first')
  const code = await waitForSignupCode(email)
  await page.getByTestId('onboarding-code').fill(code)
  await page.getByRole('button', { name: /^verify$/i }).click()

  await expect(screen).toHaveAttribute('data-screen', 'step:accept_terms', { timeout: 30_000 })
  await page.getByRole('checkbox').nth(0).click()
  await page.getByRole('checkbox').nth(1).click()
  await page.getByTestId('accept-terms-continue').click()

  // Step 1: the master key. No password field yet.
  await expect(page.getByTestId('phrase-words')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('onboarding-password')).toHaveCount(0)
  const words: string[] = []
  for (let i = 1; i <= 12; i++) words.push((await page.getByTestId(`phrase-word-${i}`).innerText()).trim())
  await page.getByRole('checkbox', { name: /I have saved my master key somewhere safe/i }).click()
  await page.getByTestId('phrase-saved').click()
  const inputs = page.locator('[data-testid^="phrase-answer-"]')
  await expect(inputs).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    const id = (await inputs.nth(i).getAttribute('data-testid'))!
    await page.getByTestId(id).fill(words[Number(id.replace('phrase-answer-', '')) - 1])
  }
  await page.getByRole('button', { name: /^confirm$/i }).click()

  // Step 2: the password.
  await expect(screen).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
  return words
}

/** Fill the password step and continue; the account is created from there. Does not assert the outcome. */
export async function createAccount(page: Page, password: string): Promise<void> {
  await page.getByTestId('onboarding-password').fill(password)
  await page.getByTestId('onboarding-password-confirm').fill(password)
  await page.getByTestId('set-password-continue').click()
}

export interface SignupAndUnlockOptions {
  /** Defaults to a fresh uniqueEmail(). */
  email?: string
  password: string
}

export interface SignedUpAccount {
  email: string
  /** Space-joined 12-word master key, for restoring the vault on another device. */
  recoveryPhrase: string
}

/**
 * Full signup flow (email → code → terms → master key → confirm → password), landing on
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

  // OPAQUE registration + key wrap can take a few seconds. Step 3 (the passkey offer) may sit in between:
  // skip it with "Not now" like a user who wants the drive, then land on the drive (step 4's card is dismissed).
  const notNow = page.getByRole('button', { name: /^not now$/i })
  await notNow.waitFor({ state: 'visible', timeout: 20_000 }).then(() => notNow.click()).catch(() => {})
  await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 }).catch(async () => { throw new Error(`stuck at ${page.url()}: ${(await page.locator('body').innerText()).slice(0, 500)}`) })
  const openDrive = page.getByTestId('first-files-open-drive')
  await openDrive.waitFor({ state: 'visible', timeout: 4_000 }).then(() => openDrive.click()).catch(() => {})
  await expect(page.getByText(/All files/i).first()).toBeVisible({
    timeout: 10_000,
  })
  return { email, recoveryPhrase: phraseWords.join(' ') }
}
