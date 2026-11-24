import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { fillSignupForm, uniqueEmail } from './helpers/signup'
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
    await fillSignupForm(page, { email })
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })

    // Email code (when the server has it).
    const codeEmail = page.getByTestId('signup-code-email')
    if (await codeEmail.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
      await noOldName(page)
      await page.getByTestId('signup-code-input').fill(await waitForSignupCode(email))
      await expect(codeEmail).toBeHidden({ timeout: 10_000 })
    }

    // 1. The 12 words come first.
    const wordEls = page.locator('span.font-mono.text-sm.font-medium')
    await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /^your master key$/i })).toBeVisible()
    await expect(page.getByText(/Your password only unlocks it on this device\./).first()).toBeVisible()
    await expect(page.getByPlaceholder('At least 12 characters')).toHaveCount(0)
    const words = (await wordEls.allInnerTexts()).map((w) => w.trim())
    await noOldName(page)
    await shot(page, 'words', [wordEls])

    // 2. Confirm 3 of them.
    await page.getByRole('checkbox', { name: /I have saved my master key somewhere safe, outside Beebeeb/i }).click()
    await page.getByRole('button', { name: /I saved it/i }).click()
    await expect(page.getByRole('heading', { name: /^confirm your master key$/i })).toBeVisible()
    const labels = page.locator('label', { hasText: /^Word #\d+$/ })
    await expect(labels).toHaveCount(3)
    await noOldName(page)
    await shot(page, 'confirm')
    // A wrong word is refused with the master key wording.
    await page.getByLabel((await labels.first().innerText()).trim(), { exact: true }).fill('wrongword')
    await page.getByRole('button', { name: /^verify$/i }).click()
    await expect(page.getByText("These words don't match your master key.")).toBeVisible()
    await shot(page, 'confirm-wrong')
    for (let i = 0; i < 3; i++) {
      const text = (await labels.nth(i).innerText()).trim()
      const n = Number(text.match(/#(\d+)/)![1])
      await page.getByLabel(text, { exact: true }).fill(words[n - 1])
    }
    await page.getByRole('button', { name: /^verify$/i }).click()

    // 3. The password comes last.
    await expect(page.getByRole('heading', { name: /^choose a password for this device$/i })).toBeVisible()
    await expect(page.getByText('Your password only unlocks your master key on this device.')).toBeVisible()
    await noOldName(page)
    await shot(page, 'password')
    await page.getByPlaceholder('At least 12 characters').fill(PASSWORD)
    await page.getByPlaceholder('Type it again').fill(PASSWORD)
    await page.getByRole('button', { name: /create account/i }).click()
    await expect(page).toHaveURL(/\/(?!onboarding|signup)/, { timeout: 60_000 })
  })
})
