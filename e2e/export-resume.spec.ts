import { test, expect, type Page } from '@playwright/test'
import { createAccount, fillSignupForm, reachPasswordStep, uniqueEmail } from './helpers/signup'

/**
 * Task 0720 — a data-export captured before an auth bounce resumes to
 * /settings/privacy after the user logs back in (GDPR Art. 20), instead of
 * stranding them at "/". Drives the real signup → device-provision login flow
 * (mirrors cli-auth-redirect.spec.ts), with the pending-export flag seeded as if
 * an export-mid-flow 401 had captured it. The setter (markPendingExport on the
 * export 401) is covered by code + the privacy.tsx catch; this proves the
 * harder resume half end-to-end through a real login.
 */

const STRONG_PW = 'correct-horse-battery-staple-9'

async function blockDevAutoLogin(page: Page) {
  await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
}

/**
 * Sign up a fresh account through the UI; returns its creds + recovery
 * phrase. Uses the shared helper (task 1406) — this spec's copy predated the
 * pilot-access-key field (task 0928) and was stale.
 */
async function signUp(page: Page): Promise<{ email: string; password: string; recoveryPhrase: string }> {
  const email = uniqueEmail('e2e-export')
  await fillSignupForm(page, { email })
  const phraseWords = await reachPasswordStep(page)
  await createAccount(page, STRONG_PW)
  await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 25_000 })

  return { email, password: STRONG_PW, recoveryPhrase: phraseWords.join(' ') }
}

test('a captured data-export resumes to /settings/privacy after re-login (0720)', async ({ browser }) => {
  test.setTimeout(120_000)

  // Phase 1 — create the account (establishes the server-side user).
  const setupCtx = await browser.newContext()
  const setupPage = await setupCtx.newPage()
  await blockDevAutoLogin(setupPage)
  const acct = await signUp(setupPage)
  await setupCtx.close()

  // Phase 2 — a fresh, logged-out device. Seed the pending-export flag (as a
  // mid-flow 401 would have), suppress the first-run welcome, then log in.
  const freshCtx = await browser.newContext()
  await freshCtx.addInitScript(() => {
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('bb_pending_export', String(Date.now()))
  })
  const page = await freshCtx.newPage()
  await blockDevAutoLogin(page)

  await page.goto('/login')
  await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 20_000 })
  await page.getByLabel(/email/i).fill(acct.email)
  await page.getByPlaceholder('Your password').fill(acct.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // No vault on this device → device-provision via the recovery phrase.
  // Task 1528: 12 individually-labeled word boxes, not one textarea — box 1
  // accepts a full space-separated paste and splits it across all 12
  // (device-provision.tsx applyWords).
  const phraseInput = page.getByLabel('Recovery word 1', { exact: true })
  await phraseInput.waitFor({ state: 'visible', timeout: 25_000 })
  await phraseInput.fill(acct.recoveryPhrase)
  await page.getByRole('button', { name: /restore vault/i }).click()

  // The fix: navigateAfterLogin consumes the pending export → /settings/privacy.
  await page.waitForURL(/\/settings\/privacy/, { timeout: 25_000 })

  await freshCtx.close()
})
