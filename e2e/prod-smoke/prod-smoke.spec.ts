import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import fs from 'node:fs'
import crypto from 'node:crypto'

import { PILOT_KEY, fillSignupForm, reachPasswordStep, createAccount } from '../helpers/signup'
import { anonymousContext } from '../helpers/auth'
import { openRowMenu, createShareLink } from '../helpers/drive'
import {
  readVerificationCode,
  spawnCliLogin,
  runCli,
  readCliSessionToken,
  randomPassword,
  writeSmokeCredentials,
  clearSmokeCredentials,
  signIn,
  type VerificationCodeSource,
} from './helpers'

/**
 * Task 1495 — scripted production smoke: the whole account lifecycle driven
 * through the REAL UI (no dev auto-login, no API shortcuts except where a
 * step genuinely has no UI — there are none here) against one throwaway
 * `smoke+<run-id>@beebeeb.io` account.
 *
 * Run via `scripts/prod-smoke.sh --target local|prod` — that driver owns the
 * target's lifecycle (its own isolated local API+Vite instance, or
 * production, lead-only) and sets every env var this file reads. Running
 * this file directly with `bunx playwright test --config=playwright.prod-smoke.config.ts`
 * works too as long as those env vars are already exported.
 *
 * ONE ordered story, not independent specs — `test.describe.serial` shares a
 * single browser context/page across steps (module-scoped `page`, not the
 * `page` fixture) exactly like a real user's one continuous session, and a
 * failed step skips the rest (Playwright's serial-mode default) rather than
 * limping on with an account in an unknown state. Trap-based cleanup (see
 * `scripts/prod-smoke.sh`) deletes the throwaway account regardless of where
 * the run stopped — see that script for the forced-failure cleanup proof.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Dismiss the first-run "Welcome, <name>" tour modal (src/components/welcome-tour.tsx)
 * if it's showing. Found the hard way (task 1495 notes): its `fixed inset-0
 * z-50` backdrop intercepted every subsequent click (including the email
 * banner's "Enter code" button) until dismissed. `onClose` persists via
 * `setPreference('welcome_tour', …)` (an account-scoped server preference,
 * not per-browser-context localStorage), so dismissing it once here means it
 * never reappears for this account on later logins in this run.
 */
async function dismissWelcomeTourIfPresent(page: Page): Promise<void> {
  const skipBtn = page.getByRole('button', { name: /^(skip for now|close)$/i })
  if (await skipBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipBtn.click()
    await skipBtn.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  }
}

const RUN_ID = process.env.E2E_SMOKE_RUN_ID ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const EMAIL = `smoke+${RUN_ID}@beebeeb.io`
// Random per-run passwords (task 1495, Codex extra #4) — never a fixed
// committed literal, never logged. See helpers.ts's randomPassword doc.
const PASSWORD_INITIAL = randomPassword()
const PASSWORD_CHANGED = randomPassword()

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'
const VERIFICATION_SOURCE = (process.env.E2E_VERIFICATION_SOURCE ?? 'mailpit') as VerificationCodeSource

const CLI_BIN = process.env.E2E_CLI_BIN
const CLI_HOME = process.env.E2E_CLI_HOME
const CLI_API_URL = process.env.E2E_CLI_API_URL ?? process.env.E2E_API_URL ?? 'http://localhost:3001'

// Red-proof lever (see scripts/prod-smoke.sh's --prove-red / the task's
// "seen red first" evidence): flips a byte of the downloaded content before
// the comparison so the assertion is proven load-bearing, not a tautology.
const FORCE_BAD_BYTES = process.env.E2E_SMOKE_FORCE_BAD_BYTES === '1'

const fileName = `prod-smoke-${RUN_ID}.txt`
const fileContent = `Beebeeb prod-smoke ${RUN_ID} :: ${crypto.randomBytes(24).toString('hex')}\n`

let recoveryPhrase = ''

test.describe.serial('Production smoke — one throwaway account, real UI (task 1495)', () => {
  let context: BrowserContext
  let page: Page

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
    // Pre-seed cookie consent (task 1495 notes: the undismissed banner's
    // focus trap swallowed the preview's Escape-to-close keypress in step 4)
    // — the smoke flow isn't testing cookie-consent UX, so accepting it the
    // same way cli-auth-redirect.spec.ts does (bb_cookie_consent='all' via
    // addInitScript) keeps the 10 real steps this task cares about from
    // being blocked by an unrelated banner.
    await context.addInitScript(() => {
      localStorage.setItem('bb_cookie_consent', 'all')
    })
    page = await context.newPage()
    // Real-user flow only — never let a dev-mode auto-login bypass short-circuit
    // any step (mirrors every other unauthenticated-flow spec in this suite).
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('1. signup with pilot key — recovery phrase shown + confirmed — password set', async () => {
    test.setTimeout(60_000)
    await fillSignupForm(page, { email: EMAIL, pilotKey: PILOT_KEY })
    const words = await reachPasswordStep(page)
    recoveryPhrase = words.join(' ')
    await createAccount(page, PASSWORD_INITIAL)

    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 30_000 })
    await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 10_000 })
    await dismissWelcomeTourIfPresent(page)

    // Scratch credentials handoff for the EXIT-trap cleanup (Codex P1,
    // prod-smoke.sh:175) — a no-op for --target local (env var unset). Write
    // this as the LAST thing in the test, right after the account is
    // confirmed to exist, so the window where the trap could fire with a
    // stale/missing credentials file is as small as possible.
    writeSmokeCredentials(EMAIL, PASSWORD_INITIAL)
  })

  test('2. email verification (mailpit locally, a polled scratch file on prod)', async () => {
    // The `file` source (prod) can legitimately wait up to 10 minutes for a
    // human to read the code and write it — well past the suite's 90s default
    // (playwright.prod-smoke.config.ts). `mailpit` (local) stays fast.
    test.setTimeout(VERIFICATION_SOURCE === 'file' ? 11 * 60_000 : 45_000)
    const code = await readVerificationCode(EMAIL, { source: VERIFICATION_SOURCE, mailpitUrl: MAILPIT_URL })

    const banner = page.getByRole('status').filter({ hasText: /verification code/i })
    await expect(banner).toBeVisible({ timeout: 10_000 })
    await banner.getByRole('button', { name: 'Enter code' }).click()
    await banner.getByLabel('Verification code').fill(code)
    await banner.getByRole('button', { name: 'Verify' }).click()

    // The banner unmounts once AuthContext refreshes and user.email_verified is true.
    await expect(banner).toBeHidden({ timeout: 10_000 })
  })

  test('3. upload a file, download it, compare bytes', async () => {
    test.setTimeout(60_000)
    await page.locator('input[type="file"]').first().setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileContent, 'utf8'),
    })
    await expect(page.getByText(fileName, { exact: false }).first()).toBeVisible({ timeout: 30_000 })

    await openRowMenu(page, fileName)
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('menuitem', { name: /^Download/ }).click(),
    ])
    const downloadedPath = await download.path()
    expect(downloadedPath, 'download must produce a saved file').toBeTruthy()

    let downloaded = fs.readFileSync(downloadedPath!, 'utf8')
    if (FORCE_BAD_BYTES) {
      // Deliberate mutation — see the RED-PROOF note in scripts/prod-smoke.sh.
      const last = downloaded.at(-1)
      downloaded = downloaded.slice(0, -1) + (last === 'x' ? 'y' : 'x')
    }
    expect(downloaded, 'downloaded + decrypted bytes must equal the uploaded content').toBe(fileContent)
  })

  test('4. preview the file', async () => {
    test.setTimeout(30_000)
    await page.getByRole('row', { name: new RegExp(escapeRegExp(fileName)) }).first().dblclick()
    const overlay = page.locator('.absolute.inset-0.z-30')
    await overlay.first().waitFor({ state: 'visible', timeout: 15_000 })

    // .first(): the filename renders twice inside the overlay chrome (the
    // top-bar title AND the right-rail metadata panel) — found the hard way,
    // see task 1495 notes (a bare getByText hit a strict-mode violation).
    await expect(overlay.getByText(fileName, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
    // The trust line only renders once loadAndDecrypt actually succeeded —
    // proof the preview rendered real decrypted content, not an error card.
    await expect(overlay.getByText(/decrypted locally/i).first()).toBeVisible({ timeout: 15_000 })

    await page.keyboard.press('Escape')
    await overlay.waitFor({ state: 'hidden', timeout: 10_000 })
  })

  test('5. share link opened logged-out decrypts to identical content', async () => {
    test.setTimeout(60_000)
    const shareUrl = await createShareLink(page, fileName)
    expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]+#key=/)

    const browser = context.browser()
    if (!browser) throw new Error('no Browser handle available from the smoke context')
    const anonCtx = await anonymousContext(browser)
    const recipient = await anonCtx.newPage()
    await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
    try {
      await recipient.goto(shareUrl)
      await expect(recipient.getByText(fileName, { exact: false })).toBeVisible({ timeout: 30_000 })

      const downloadBtn = recipient.getByRole('button', { name: /download and decrypt/i })
      await expect(downloadBtn).toBeVisible({ timeout: 10_000 })
      const [download] = await Promise.all([
        recipient.waitForEvent('download', { timeout: 30_000 }),
        downloadBtn.click(),
      ])
      const p = await download.path()
      expect(p, 'share-view download must produce a saved file').toBeTruthy()
      expect(fs.readFileSync(p!, 'utf8')).toBe(fileContent)
    } finally {
      await anonCtx.close()
    }
  })

  test('6. sign out, then sign in again', async () => {
    test.setTimeout(30_000)
    await page.locator('button[aria-haspopup="menu"]').first().click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await page.waitForURL(/\/login/, { timeout: 15_000 })

    // Found the hard way (task 1495 notes): "Log out" is a FULL logout —
    // key-context.tsx's fullLogout() explicitly wipes the IndexedDB vault
    // too ("the device should not retain wrapped keys" — intentional, not a
    // bug), so re-login on this same browser hits DeviceProvision exactly
    // like a fresh device does. Supply the phrase here too.
    await signIn(page, { email: EMAIL, password: PASSWORD_INITIAL, recoveryPhrase })
    await expect(page.getByText(fileName, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  })

  test('7. CLI login via browser handoff (isolated HOME); bb ls lists the file', async () => {
    test.setTimeout(60_000)
    test.skip(
      !CLI_BIN || !CLI_HOME,
      'E2E_CLI_BIN / E2E_CLI_HOME not set — scripts/prod-smoke.sh builds the CLI and provisions an isolated HOME before running Playwright',
    )

    const handle = spawnCliLogin(CLI_BIN!, CLI_HOME!, CLI_API_URL)
    const { url } = await handle.waitForAuthUrl(20_000)

    // The already-authenticated smoke user's own page authorizes the CLI —
    // exactly the real gh-auth-login-style handoff, no code shortcuts.
    await page.goto(url)
    const authorizeBtn = page.getByRole('button', { name: /authorize cli access/i })
    await expect(authorizeBtn).toBeVisible({ timeout: 15_000 })
    await authorizeBtn.click()
    await expect(page.getByText(/you're all set/i)).toBeVisible({ timeout: 15_000 })

    const { exitCode, output } = await handle.waitForExit(20_000)
    expect(exitCode, `bb login did not exit 0:\n${output}`).toBe(0)
    expect(output).toContain('Logged in as')
    expect(output).toContain(EMAIL)

    const cliSessionToken = readCliSessionToken(CLI_HOME!)
    expect(cliSessionToken, 'bb login should have persisted a session_token under the isolated HOME').toBeTruthy()

    const lsOutput = runCli(CLI_BIN!, ['ls'], CLI_HOME!, CLI_API_URL)
    expect(lsOutput).toContain(fileName)
  })

  test('8. change password', async () => {
    test.setTimeout(30_000)
    await page.goto('/settings/security')
    await page.getByRole('button', { name: /^change password$/i }).click()

    const dialog = page.getByRole('dialog', { name: /change password/i })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByLabel(/current password/i).fill(PASSWORD_INITIAL)
    await dialog.getByLabel(/^new password$/i).fill(PASSWORD_CHANGED)
    await dialog.getByLabel(/confirm new password/i).fill(PASSWORD_CHANGED)
    await dialog.getByRole('button', { name: /^change password$/i }).click()

    await expect(dialog).toBeHidden({ timeout: 15_000 })

    // Re-point the EXIT-trap's scratch credentials at the NEW password —
    // from here on, a trap-fired cleanup must sign in with PASSWORD_CHANGED,
    // not the now-stale PASSWORD_INITIAL. No-op on --target local.
    writeSmokeCredentials(EMAIL, PASSWORD_CHANGED)
  })

  test('9. recover with the phrase on a fresh context; the file decrypts', async ({ browser }) => {
    test.setTimeout(45_000)
    const freshCtx = await browser.newContext()
    const freshPage = await freshCtx.newPage()
    await freshPage.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    try {
      // No local vault on this context → signIn's DeviceProvision branch:
      // password gets you in, the PHRASE is what restores the vault.
      await signIn(freshPage, {
        email: EMAIL,
        password: PASSWORD_CHANGED,
        recoveryPhrase,
      })
      await expect(freshPage.getByText(fileName, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    } finally {
      await freshCtx.close()
    }
  })

  test('10. delete the account; afterwards login fails and the API returns 401', async () => {
    test.setTimeout(45_000)

    // Capture a session token minted from the CURRENT (post-password-change,
    // test 8) cookie session, and prove it's valid, BEFORE triggering
    // deletion. Codex P2 (prod-smoke.spec.ts:362): the OLD check used
    // `cliSessionToken` from test 7, but test 8's password change invalidates
    // ALL sessions (src/lib/api.ts's change-password-finish handling — server:
    // routes/password.rs's change_password_finish does `DELETE FROM sessions`
    // then mints one fresh one) — so that token was ALREADY 401 by the time
    // this test ran, making the post-delete 401 assertion pass for the wrong
    // reason regardless of whether delete-account itself revokes sessions.
    // `GET /auth/session-token` (routes/auth.rs, task 0447) hands back the raw
    // bearer token for whichever session the CALLER'S COOKIE is currently
    // authenticated as — `page`'s cookie was refreshed by test 8's response
    // and untouched since (test 9 used a SEPARATE browser context), so this
    // is exactly "a session after the password change".
    const tokenRes = await page.request.get(`${CLI_API_URL}/api/v1/auth/session-token`)
    expect(tokenRes.ok(), 'GET /auth/session-token must succeed for the current cookie session').toBeTruthy()
    const { token: freshSessionToken } = (await tokenRes.json()) as { token: string }
    expect(freshSessionToken, 'session-token endpoint should return a non-empty token').toBeTruthy()

    const preDeleteMe = await page.request.get(`${CLI_API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${freshSessionToken}` },
    })
    // This is the assertion that makes the post-delete 401 below meaningful —
    // seen RED by commenting out the deletion call below and re-running: the
    // account then never gets deleted, so THIS check still passes (200) but
    // the post-delete 401 assertion fails with "expected 401, got 200" (task
    // 1495 notes has the pasted failure).
    expect(preDeleteMe.status(), 'freshly captured post-password-change session must be valid before deletion').toBe(
      200,
    )

    await page.goto('/settings/delete-account')
    await expect(page.getByText(/Delete your account/i)).toBeVisible({ timeout: 10_000 })

    await page.getByPlaceholder('DELETE').fill('DELETE')
    await page.getByRole('checkbox', { name: /files are encrypted and cannot be recovered/i }).click()
    await page.getByRole('button', { name: /^delete permanently$/i }).click()

    await expect(page.getByRole('dialog', { name: /confirm your identity/i })).toBeVisible({ timeout: 10_000 })
    await page.getByLabel(/^password$/i).fill(PASSWORD_CHANGED)
    await page.getByRole('button', { name: /^delete account$/i }).click()
    await page.waitForURL(/\/login/, { timeout: 15_000 })

    // (a) the UI: logging back in with the deleted account's credentials must fail.
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 15_000 })
    await page.getByLabel(/email/i).fill(EMAIL)
    await page.getByPlaceholder('Your password').fill(PASSWORD_CHANGED)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    const errorBox = page.locator('p.text-red, p.text-xs.text-red').first()
    await expect(errorBox).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)

    // (b) the API: the session proven valid ABOVE, immediately before
    // deletion, must now 401 — account deletion revokes every session row
    // server-side (server: DELETE FROM sessions WHERE user_id = $1,
    // routes/account.rs). Unconditional (not `if (cliSessionToken)`) —
    // freshSessionToken always exists by this point, the earlier check threw
    // otherwise.
    const postDeleteMe = await page.request.get(`${CLI_API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${freshSessionToken}` },
    })
    expect(
      postDeleteMe.status(),
      'a session valid immediately before deletion must now 401 once the account is deleted',
    ).toBe(401)

    // Account confirmed deleted through both surfaces — the EXIT trap no
    // longer needs to (and must not try to) delete it again. Last action of
    // the happy path.
    clearSmokeCredentials()
  })
})
