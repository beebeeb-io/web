import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { createAccount, fillSignupForm, reachPasswordStep, uniqueEmail } from './helpers/signup'
import { waitForSignupCode } from './helpers/mail-sink'

/**
 * Master key naming, task 02: the live sign-up shows the master key FIRST (12 words, confirm 3),
 * then the password, and no step says "recovery phrase". A capture per step goes to
 * E2E_EVIDENCE_DIR (default board/evidence/master-key-naming/02) as shot-<step>.png; the word grid
 * is masked before every shot, so no real words are ever saved.
 */

const EVIDENCE =
  process.env.E2E_EVIDENCE_DIR ?? join(process.cwd(), '..', '..', 'board', 'evidence', 'master-key-naming', '02')
const PASSWORD = 'CorrectHorseBattery9!'
const FORBIDDEN = /recovery phrase|recovery words|safety key/i

async function shot(page: Page, step: string, mask: Locator[] = []) {
  mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE, `shot-${step}.png`), fullPage: true, mask })
}

async function noOldName(page: Page) {
  expect(await page.locator('body').innerText()).not.toMatch(FORBIDDEN)
}

test.describe('Sign-up: master key first (live flow)', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await context.clearCookies()
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('12 words, confirm 3, then the password; no "recovery phrase" on any step', async ({ page }) => {
    const email = uniqueEmail('mk-signup')
    const screen = page.getByTestId('onboarding-screen')
    await fillSignupForm(page, { email })
    await expect(screen).toHaveAttribute('data-screen', 'step:verify_email_code', { timeout: 30_000 })
    await noOldName(page)
    await page.getByTestId('onboarding-code').fill(await waitForSignupCode(email))
    await page.getByRole('button', { name: /^verify$/i }).click()
    await expect(screen).toHaveAttribute('data-screen', 'step:accept_terms', { timeout: 30_000 })
    await noOldName(page)
    await page.getByRole('checkbox').nth(0).click()
    await page.getByRole('checkbox').nth(1).click()
    await page.getByTestId('accept-terms-continue').click()

    // 1. The 12 words come first.
    const grid = page.getByTestId('phrase-words')
    await expect(grid).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /^your master key$/i })).toBeVisible()
    await expect(page.getByText(/Your password only unlocks it on this device\./).first()).toBeVisible()
    await expect(page.getByTestId('onboarding-password')).toHaveCount(0)
    const words: string[] = []
    for (let i = 1; i <= 12; i++) words.push((await page.getByTestId(`phrase-word-${i}`).innerText()).trim())
    await noOldName(page)
    await shot(page, 'words', [grid])

    // 2. Confirm 3 of them.
    await page.getByRole('checkbox', { name: /I have saved my master key somewhere safe/i }).click()
    await page.getByTestId('phrase-saved').click()
    await expect(page.getByRole('heading', { name: /^confirm your master key$/i })).toBeVisible()
    const inputs = page.locator('[data-testid^="phrase-answer-"]')
    await expect(inputs).toHaveCount(3)
    await noOldName(page)
    await shot(page, 'confirm')
    for (let i = 0; i < 3; i++) {
      const id = (await inputs.nth(i).getAttribute('data-testid'))!
      await page.getByTestId(id).fill(words[Number(id.replace('phrase-answer-', '')) - 1])
    }
    await page.getByRole('button', { name: /^confirm$/i }).click()

    // 3. The password comes last.
    await expect(screen).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /^choose a password for this device$/i })).toBeVisible()
    await expect(page.getByText('Your password only unlocks your master key on this device.')).toBeVisible()
    await noOldName(page)
    await shot(page, 'password')
    await createAccount(page, PASSWORD)
    await expect(page).toHaveURL(/\/(?!onboarding|signup)/, { timeout: 60_000 })
  })
})

// ── Task 13: steps 3 and 4 (passkey, first files) ─────────────────────────────────────────────
const EVIDENCE_13 =
  process.env.E2E_EVIDENCE_DIR_13 ?? join(process.cwd(), '..', '..', 'board', 'evidence', 'master-key-naming', '13')

async function shot13(page: Page, frame: string, mask: Locator[] = []) {
  mkdirSync(EVIDENCE_13, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_13, `shot-${frame}.png`), fullPage: true, mask })
}

/** A built-in authenticator with user verification and PRF, as Touch ID / Windows Hello would be. */
async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  })
}

/** Steps 1 and 2: words, confirm, password. Resolves on the passkey card (step 3). */
async function throughSteps1And2(page: Page, tag: string) {
  const email = uniqueEmail(tag)
  await fillSignupForm(page, { email })
  await reachPasswordStep(page)
  await shot13(page, 'WB-K03')
  await createAccount(page, PASSWORD)
  await expect(page.getByRole('heading', { name: /^add a passkey$/i })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Step 3 of 4')).toBeVisible()
  return { email }
}

test.describe('Sign-up: passkey (step 3) and first files (step 4)', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
    await context.clearCookies()
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('walks steps 1-4 and the passkey unlocks the vault after a reload', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await throughSteps1And2(page, 'mk-passkey')
    await shot13(page, 'WB-K05')
    await page.getByRole('button', { name: /^add a passkey$/i }).click()

    // Step 4: the first-files card on the first drive load (after the account steps, if any).
    const card = page.getByTestId('first-files')
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Step 4 of 4')).toBeVisible()
    await shot13(page, 'WB-K06')

    // Once dismissed it does not come back, and the passkey unlocks the vault after a reload.
    await page.getByTestId('first-files-open-drive').click()
    await expect(card).toBeHidden()
    await page.reload()
    await expect(card).toHaveCount(0)
    const unlock = page.getByRole('button', { name: /passkey/i })
    if (await unlock.first().isVisible().catch(() => false)) {
      await unlock.first().click()
    }
    await expect(page.getByTestId('first-files')).toHaveCount(0)
    await expect(page.getByText(/enter your password|unlock your vault/i)).toHaveCount(0, { timeout: 30_000 })
  })

  test('"Not now" skips the passkey and goes on', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await throughSteps1And2(page, 'mk-notnow')
    await page.getByRole('button', { name: /^not now$/i }).click()
    await expect(page.getByRole('heading', { name: /^add a passkey$/i })).toBeHidden({ timeout: 60_000 })
    await expect(page).toHaveURL(/\/(choose-plan|drive|files|$)/, { timeout: 60_000 })
  })
})
