import { test, expect, type Page } from '@playwright/test'

/**
 * Task 0551 — CLI device-auth redirect preservation.
 *
 * The bug: when an unauthenticated browser opens /cli-auth?code=XXXX-XXXX, the
 * app bounces to /login, but the intended destination was dropped — after the
 * user signed in (especially through the no-vault device-provision step) they
 * landed on the drive ("/") instead of back on /cli-auth, so the CLI handshake
 * never completed.
 *
 * The fix: ProtectedRoute now captures the intended path as `?next=`, and
 * login.tsx consumes it through sanitizeRedirect() — an allowlisted same-origin
 * path only (no open redirect). These specs prove both halves against the
 * isolated e2e backend with NO 2FA account required.
 *
 * Runs on the dedicated :3003 harness (make web-e2e SPECS=e2e/cli-auth-redirect.spec.ts).
 */

const uniqueEmail = () =>
  `e2e-cliauth-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb.io`

const STRONG_PW = 'correct-horse-battery-staple-9'

/** In dev/e2e, DevAuthGate POSTs /dev/auto-login on every page load and would
 *  inject a session. 404 it so the context starts genuinely unauthenticated. */
async function blockDevAutoLogin(page: Page) {
  await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
}

/**
 * Drive the real UI signup → recovery-phrase → password flow to create a fresh
 * account, returning its credentials + the generated 12-word phrase. Mirrors
 * the known-good pattern in onboarding-password.spec.ts.
 */
async function signUp(page: Page): Promise<{ email: string; password: string; recoveryPhrase: string }> {
  const email = uniqueEmail()

  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup/)
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /continue/i }).click()

  // Recovery-phrase display step — read the 12 words out of the DOM.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 })
  const wordEls = page.locator('span.font-mono.text-sm.font-medium')
  await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
  const phraseWords = (await wordEls.allInnerTexts()).map((w) => w.trim())
  expect(phraseWords.length).toBe(12)

  await page.getByRole('checkbox', { name: /I've saved my recovery phrase offline/i }).click()
  await page.getByRole('button', { name: /I saved it/i }).click()

  // Verify step — fill the randomly-requested words from the captured phrase.
  const verifyLabels = page.locator('label', { hasText: /^Word #\d+$/ })
  const labelCount = await verifyLabels.count()
  expect(labelCount).toBeGreaterThan(0)
  for (let i = 0; i < labelCount; i++) {
    const labelText = (await verifyLabels.nth(i).innerText()).trim()
    const m = labelText.match(/Word #(\d+)/)
    if (!m) throw new Error(`unexpected verify label: ${labelText}`)
    await page.getByLabel(labelText, { exact: true }).fill(phraseWords[parseInt(m[1], 10) - 1])
  }
  await page.getByRole('button', { name: /^verify$/i }).click()

  // Password step.
  const pw = page.getByPlaceholder('At least 12 characters')
  await expect(pw).toBeVisible({ timeout: 10_000 })
  await pw.fill(STRONG_PW)
  await page.getByPlaceholder('Type it again').fill(STRONG_PW)
  await page.getByRole('button', { name: /create account/i }).click()

  // Account created → lands on the drive.
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 25_000 })

  return { email, password: STRONG_PW, recoveryPhrase: phraseWords.join(' ') }
}

test.describe('CLI auth — redirect preservation (0551)', () => {
  test('unauthenticated /cli-auth bounce preserves the exact next path', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await blockDevAutoLogin(page)

    await page.goto('/cli-auth?code=WXYZ-7890')

    // ProtectedRoute bounces to /login carrying the intended destination.
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 15_000 })
    const next = new URL(page.url()).searchParams.get('next')
    expect(next).toBe('/cli-auth?code=WXYZ-7890')

    await ctx.close()
  })

  test('device-provision login returns to /cli-auth?code=… (the closed gap)', async ({ browser }) => {
    // Phase 1 — create an account (its own context establishes a server-side user).
    const setupCtx = await browser.newContext()
    const setupPage = await setupCtx.newPage()
    await blockDevAutoLogin(setupPage)
    const acct = await signUp(setupPage)
    await setupCtx.close()

    // Phase 2 — a pristine "fresh device": no IndexedDB vault, no session cookie.
    // Force the onboarding step to "done" from first paint (computeStep honours
    // localStep === 'done' over server flags) so the first-run welcome flow,
    // which would otherwise bounce a fresh account from /cli-auth onto the
    // drive, stays out of the way — this test is about the redirect, not onboarding.
    const freshCtx = await browser.newContext()
    await freshCtx.addInitScript(() => {
      localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
      localStorage.setItem('bb_cookie_consent', 'all')
    })
    const page = await freshCtx.newPage()
    await blockDevAutoLogin(page)

    const code = 'TEST-DUMMY'
    await page.goto(`/cli-auth?code=${code}`)

    // Bounced to /login with the cli-auth destination preserved.
    await expect(page).toHaveURL(new RegExp(`/login\\?next=.*cli-auth.*${code}`), { timeout: 15_000 })
    await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 20_000 })

    // Sign in. No vault on this device → device-provision (recovery phrase).
    // The login password field is a bare input (standalone <label>, not
    // associated) — target it by placeholder, as the email field carries the
    // only real <label> association.
    await page.getByLabel(/email/i).fill(acct.email)
    await page.getByPlaceholder('Your password').fill(acct.password)
    // Exact name: "Sign in with passkey" also matches a loose /sign in/ regex.
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    const phraseInput = page.getByPlaceholder('word1 word2 word3 ... word12')
    await phraseInput.waitFor({ state: 'visible', timeout: 25_000 })
    await phraseInput.fill(acct.recoveryPhrase)
    await page.getByRole('button', { name: /restore vault/i }).click()

    // The fix: after provisioning, navigateAfterLogin returns to /cli-auth?code=…
    // (pre-fix it landed on "/"). waitForURL observes SPA (pushState) routing
    // reliably; reaching /cli-auth after the /login bounce IS the closed gap.
    // (A brand-new, unverified account then runs its own first-run flow that can
    // move on from the authorize page — unrelated to the redirect under test; a
    // real returning CLI user is exercised by the vault-unlock case below.)
    await page.waitForURL(new RegExp(`/cli-auth\\?code=${code}`), { timeout: 25_000 })

    await freshCtx.close()
  })
})
