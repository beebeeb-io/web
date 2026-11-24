import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { PASSWORD, codeFromMailpit, missingPrerequisites, screen, skipTours } from './helpers/no-card-trial'
import { uniqueEmail } from './helpers/signup'

/**
 * po-16: sign up on the web with "I already have a master key" using a phrase from core's
 * `generate_recovery_phrase` (what the offline Pass vault would hold), then sign in to Pass web
 * (PASS_WEB_URL, default http://localhost:5175) with that account and phrase: the vault opens.
 *
 * Local stack: API on :3001 with BB_RATE_LIMIT_DISABLED=1 and Mailpit; this web app on baseURL;
 * Pass web on :5175 (web/scripts/pass-local.sh). Runs in the finish check.
 */
const PASS_WEB_URL = process.env.PASS_WEB_URL ?? 'http://localhost:5175'

async function freshPhrase(): Promise<string> {
  const dir = join(__dirname, '..', 'packages', 'beebeeb-wasm')
  const wasm = await import(join(dir, 'beebeeb_wasm.js'))
  wasm.initSync({ module: readFileSync(join(dir, 'beebeeb_wasm_bg.wasm')) })
  const p = wasm.generate_recovery_phrase() as unknown
  return typeof p === 'string' ? p : String((p as { phrase?: string }).phrase ?? p)
}

test('sign up with an existing phrase, then open the vault in Pass web', async ({ page, browser }) => {
  const missing = await missingPrerequisites()
  test.skip(missing.length > 0, `local stack not ready: ${missing.join(', ')}`)
  const phrase = await freshPhrase()
  const words = phrase.split(' ')
  expect(words).toHaveLength(12)
  const email = uniqueEmail('po16')

  await page.addInitScript(() => localStorage.setItem('bb_cookie_consent', 'all'))
  await page.goto('/signup?nodev=1')
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 30_000 })
  await page.getByTestId('onboarding-email').fill(email)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
  await page.getByTestId('onboarding-code').fill(await codeFromMailpit(email))
  await page.getByRole('button', { name: /^verify$/i }).click()
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:accept_terms')
  await page.getByRole('checkbox').nth(0).click()
  await page.getByRole('checkbox').nth(1).click()
  await page.getByTestId('accept-terms-continue').click()
  // The master key step comes first: a bad key first, then the real one pasted into the first field.
  await expect(page.getByTestId('adopt-link')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('adopt-link').click()
  await expect(page.getByText('Your offline Pass vault will open with this account.')).toBeVisible()
  await page.getByTestId('adopt-word-1').fill(Array.from({ length: 12 }, () => 'abandon').join(' '))
  await page.getByTestId('adopt-continue').click()
  await expect(page.getByText('That is not a valid master key. Check the 12 words and their order.')).toBeVisible()
  await page.getByTestId('adopt-word-1').fill(phrase)
  for (let i = 0; i < 12; i++) await expect(page.getByTestId(`adopt-word-${i + 1}`)).toHaveValue(words[i])
  await page.getByTestId('adopt-continue').click()

  // No confirm sub-step: straight on to the password step, then account creation.
  await expect(page.locator('[data-phase="confirm"]')).toHaveCount(0)
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
  await page.getByTestId('onboarding-password').fill(PASSWORD)
  await page.getByTestId('onboarding-password-confirm').fill(PASSWORD)
  await page.getByTestId('set-password-continue').click()
  await page.waitForURL((u) => u.pathname === '/' || u.pathname === '/choose-plan', { timeout: 90_000 })
  await skipTours(page)

  // Pass web with that account and phrase: the vault opens.
  const ctx = await browser.newContext()
  const pass = await ctx.newPage()
  await pass.goto(PASS_WEB_URL)
  await pass.getByLabel(/email/i).first().fill(email)
  await pass.getByLabel(/password/i).first().fill(PASSWORD)
  await pass.getByRole('button', { name: /sign in|log in|continue/i }).first().click()
  const phraseField = pass.getByTestId('recovery-phrase-input')
  if (await phraseField.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await phraseField.fill(phrase)
    await pass.getByRole('button', { name: /unlock|open|continue/i }).first().click()
  }
  await expect(pass.getByTestId('vault-list')).toBeVisible({ timeout: 60_000 })
  await ctx.close()
})
