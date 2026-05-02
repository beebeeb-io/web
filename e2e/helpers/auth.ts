import type { Page } from '@playwright/test'

export interface LoginAndProvisionOptions {
  email: string
  password: string
  /**
   * 12-word BIP39 recovery phrase for the account. Used only if the test
   * browser context has no IndexedDB vault yet (fresh profile, first run on
   * this machine, or after `clearVault()`). Existing vaults are unlocked with
   * the password without ever prompting for the phrase.
   */
  recoveryPhrase?: string
  /** Override base URL for the dev server. Defaults to whatever Playwright is configured with. */
  loginPath?: string
  /** Hard cap for the whole flow. Default 20s — OPAQUE + Argon2id can be slow on cold workers. */
  timeoutMs?: number
}

/**
 * Drive the real OPAQUE login UI end-to-end, including the DeviceProvision
 * step that appears on a fresh browser context (no IndexedDB vault yet).
 *
 * Production parity: this exercises the same code paths as a real user — no
 * test-only auth bypass. The recovery phrase is required only the first time
 * a given browser context logs in; subsequent runs use the wrapped vault key
 * already stored in IndexedDB.
 *
 * Pre-requisites:
 *   - Server running at /api/v1/opaque/login-{start,finish}
 *   - The account exists with an OPAQUE password file (i.e. it was created
 *     via the UI signup flow, not a legacy password POST)
 *
 * Resolves once the browser is on `/` (drive). Throws if the form errors,
 * the WASM worker fails to load, or the recovery phrase is rejected.
 */
export async function loginAndProvision(
  page: Page,
  opts: LoginAndProvisionOptions,
): Promise<void> {
  const loginPath = opts.loginPath ?? '/login'
  const overall = opts.timeoutMs ?? 20_000

  await page.goto(loginPath)

  // Wait for the WASM crypto worker to finish initializing. Without this the
  // form submit short-circuits with "Encryption module is not loaded yet."
  await page.waitForSelector('body[data-crypto-ready="true"]', {
    timeout: overall,
  })

  await page.getByLabel(/email/i).fill(opts.email)
  await page.getByLabel(/^password$/i).first().fill(opts.password)
  await page.getByRole('button', { name: /log in|sign in/i }).click()

  // Two possible terminal states after submit:
  //   (a) vaultExists  → unlockVault → navigate('/') → on the drive
  //   (b) !vaultExists → render <DeviceProvision> → recovery phrase prompt
  // Race the two so we don't hang on whichever doesn't apply.
  const provisionLocator = page.getByLabel(/recovery phrase/i)
  const driveReached = page
    .waitForURL(/\/(?:$|\?|#)/, { timeout: overall })
    .then(() => 'drive' as const)
    .catch(() => null)
  const provisionShown = provisionLocator
    .waitFor({ state: 'visible', timeout: overall })
    .then(() => 'provision' as const)
    .catch(() => null)

  const winner = await Promise.race([driveReached, provisionShown])
  if (winner === 'drive') return

  if (winner !== 'provision') {
    throw new Error(
      'Login did not reach drive or DeviceProvision. Check console / network for OPAQUE errors.',
    )
  }

  if (!opts.recoveryPhrase) {
    throw new Error(
      'No vault on this device — DeviceProvision is shown but no recoveryPhrase was supplied.',
    )
  }

  await provisionLocator.fill(opts.recoveryPhrase)
  await page.getByRole('button', { name: /restore vault/i }).click()
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: overall })
}

/**
 * Read test-account credentials from the environment. Set these in a local
 * `.env` (gitignored — see `.env.example`) so secrets never enter the public
 * repo. Returns `null` if any value is missing so individual tests can
 * `test.skip` cleanly.
 */
export function envTestAccount():
  | { email: string; password: string; recoveryPhrase: string }
  | null {
  const email = process.env.BB_TEST_USER_EMAIL
  const password = process.env.BB_TEST_USER_PASSWORD
  const recoveryPhrase = process.env.BB_TEST_USER_RECOVERY_PHRASE
  if (!email || !password || !recoveryPhrase) return null
  return { email, password, recoveryPhrase }
}
