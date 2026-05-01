import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the sharing flow.
 *
 * Covers:
 *   - Owner: signup → upload → create share link → copy URL with key fragment
 *   - Recipient: open link in fresh context → see decrypted filename → download
 *   - Passphrase variant: recipient must enter the passphrase to unlock
 *
 * Prerequisites (manual setup required):
 *   1. Postgres running:    docker compose -f ../../docker-compose.yml up -d postgres
 *   2. API server:          cd ../server && cargo run -p beebeeb-api
 *   3. Web dev server:      bun dev
 *
 * Run: bunx playwright test share.spec.ts
 */

const PASSWORD = 'test-password-12chars-secure!'
const uniqueEmail = () => `e2e-share-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb-test.io`

/**
 * Drive the full UI signup → onboarding flow until we land on `/`.
 * Returns when the drive page is loaded and the master key is in memory
 * (so subsequent crypto operations like file encryption / share creation work).
 */
async function signupAndOnboard(page: Page, email: string): Promise<void> {
  // ── 1. Signup form ──────────────────────────────────────────────
  await page.goto('/signup')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).first().fill(PASSWORD)
  const tos = page.getByRole('checkbox')
  if (await tos.isVisible().catch(() => false)) await tos.check()
  await page.getByRole('button', { name: /create account|sign up|get started/i }).click()

  // ── 2. Onboarding → recovery phrase display step ────────────────
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 })

  // Read the displayed recovery phrase (mnemonic words rendered with font-mono).
  // The MnemonicVerify component will ask for ~3 of these by their 1-indexed
  // position, so we capture them all up front.
  const wordEls = page.locator('.font-mono.text-sm.font-medium')
  await expect(wordEls.first()).toBeVisible({ timeout: 15_000 })
  const words = await wordEls.allInnerTexts()
  expect(words.length).toBeGreaterThanOrEqual(12)

  // Acknowledge "I've saved my recovery phrase offline" and proceed to verify.
  await page.getByLabel(/saved my recovery phrase/i).check()
  await page.getByRole('button', { name: /i saved it.*verify/i }).click()

  // ── 3. Onboarding → verify step ─────────────────────────────────
  // The verify form asks for N specific words by their 1-indexed position.
  // We read each input's `Word #N` label and fill it from the captured list.
  const verifyInputs = page.locator('label:has-text("Word #") input, input[placeholder^="Enter word"]')
  await expect(verifyInputs.first()).toBeVisible({ timeout: 5_000 })
  const inputCount = await verifyInputs.count()
  for (let i = 0; i < inputCount; i++) {
    const placeholder = await verifyInputs.nth(i).getAttribute('placeholder')
    const match = placeholder?.match(/(\d+)/)
    if (!match) throw new Error(`could not parse word index from placeholder: ${placeholder}`)
    const oneIndexed = parseInt(match[1], 10)
    const word = words[oneIndexed - 1]
    if (!word) throw new Error(`no captured word at position ${oneIndexed}`)
    await verifyInputs.nth(i).fill(word)
  }
  await page.getByRole('button', { name: /^verify$/i }).click()

  // ── 4. Onboarding → password step ──────────────────────────────
  await expect(page.getByText(/set a password/i)).toBeVisible({ timeout: 5_000 })
  await page.getByLabel(/^password$/i).fill(PASSWORD)
  await page.getByLabel(/confirm password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()

  // ── 5. Drive ──────────────────────────────────────────────────
  await expect(page).toHaveURL(/^\/$|^\/\?|^\/drive/, { timeout: 30_000 })
  await expect(page.getByText('All files')).toBeVisible({ timeout: 15_000 })
}

/**
 * Upload a small text file via the hidden file input on the drive page.
 * Returns the filename used so the caller can locate the row.
 */
async function uploadTestFile(page: Page, filename: string, contents: string): Promise<void> {
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(contents),
  })

  // The filename appears in the file listing once encryption + upload finishes.
  // Allow a generous timeout because the WASM crypto module may still be
  // warming up and the chunked upload runs through the API.
  await expect(page.getByText(filename, { exact: false }))
    .toBeVisible({ timeout: 60_000 })
}

/**
 * Open the share dialog for the given file via right-click → Share.
 */
async function openShareDialog(page: Page, filename: string): Promise<void> {
  await page.getByText(filename, { exact: false }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /share/i }).click()
  await expect(page.getByText(/share|access link/i).first()).toBeVisible({ timeout: 5_000 })
}

/**
 * Read the share URL from the dialog's readonly link input.
 */
async function readShareUrl(page: Page): Promise<string> {
  // ShareDialog renders the generated URL in a readonly input.
  const linkInput = page.locator('input[readonly]').filter({ hasNot: page.locator('[type="password"]') }).first()
  await expect(linkInput).toBeVisible({ timeout: 15_000 })
  await expect(linkInput).toHaveValue(/\/s\/[A-Za-z0-9_-]+#key=/, { timeout: 15_000 })
  return await linkInput.inputValue()
}

test.describe('Share flow E2E', () => {
  test('owner creates a link share — recipient opens it and sees the decrypted filename', async ({ browser }) => {
    test.setTimeout(120_000)

    const ownerCtx = await browser.newContext()
    const ownerPage = await ownerCtx.newPage()

    try {
      await signupAndOnboard(ownerPage, uniqueEmail())

      const filename = `share-link-${Date.now()}.txt`
      await uploadTestFile(ownerPage, filename, 'hello from share E2E')
      await openShareDialog(ownerPage, filename)

      // The dialog defaults to "link" mode; click the create/generate CTA.
      const createBtn = ownerPage.getByRole('button', {
        name: /create.*link|generate.*link|create share|copy link/i,
      })
      await createBtn.first().click()

      const shareUrl = await readShareUrl(ownerPage)
      expect(shareUrl).toMatch(/^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]+#key=/)

      // Open the share URL in a fresh context (no auth, no localStorage).
      const recipientCtx = await browser.newContext()
      const recipientPage = await recipientCtx.newPage()
      try {
        await recipientPage.goto(shareUrl)

        // Filename should decrypt and render — gives us strong evidence the
        // key fragment + share metadata flowed end-to-end.
        await expect(recipientPage.getByText(filename, { exact: false }))
          .toBeVisible({ timeout: 30_000 })

        // Download CTA should be available.
        await expect(recipientPage.getByRole('button', { name: /download/i }))
          .toBeVisible({ timeout: 10_000 })
      } finally {
        await recipientCtx.close()
      }
    } finally {
      await ownerCtx.close()
    }
  })

  test('passphrase-protected share — recipient must enter passphrase to unlock', async ({ browser }) => {
    test.setTimeout(120_000)

    const ownerCtx = await browser.newContext()
    const ownerPage = await ownerCtx.newPage()
    const passphrase = 'recipient-passphrase-e2e'

    try {
      await signupAndOnboard(ownerPage, uniqueEmail())

      const filename = `share-pass-${Date.now()}.txt`
      await uploadTestFile(ownerPage, filename, 'passphrase-protected content')
      await openShareDialog(ownerPage, filename)

      // Enable passphrase protection. The dialog has an input labelled
      // "Passphrase" (or similar) gated behind a toggle/checkbox.
      const passphraseToggle = ownerPage.getByRole('checkbox', { name: /passphrase|require/i })
      if (await passphraseToggle.isVisible().catch(() => false)) {
        await passphraseToggle.check()
      }
      const passphraseInput = ownerPage.getByLabel(/passphrase/i)
      await expect(passphraseInput.first()).toBeVisible({ timeout: 5_000 })
      await passphraseInput.first().fill(passphrase)

      await ownerPage.getByRole('button', {
        name: /create.*link|generate.*link|create share/i,
      }).first().click()

      const shareUrl = await readShareUrl(ownerPage)

      const recipientCtx = await browser.newContext()
      const recipientPage = await recipientCtx.newPage()
      try {
        await recipientPage.goto(shareUrl)

        // Wrong passphrase first — should error out without revealing the file.
        const recipientPassInput = recipientPage.getByLabel(/passphrase/i)
        await expect(recipientPassInput).toBeVisible({ timeout: 15_000 })
        await recipientPassInput.fill('definitely-wrong-passphrase')
        await recipientPage.getByRole('button', { name: /unlock|continue|verify/i }).click()
        await expect(
          recipientPage.getByText(/incorrect|invalid|wrong passphrase/i),
        ).toBeVisible({ timeout: 10_000 })

        // Correct passphrase — file should unlock.
        await recipientPassInput.fill(passphrase)
        await recipientPage.getByRole('button', { name: /unlock|continue|verify/i }).click()

        await expect(recipientPage.getByText(filename, { exact: false }))
          .toBeVisible({ timeout: 30_000 })
        await expect(recipientPage.getByRole('button', { name: /download/i }))
          .toBeVisible({ timeout: 10_000 })
      } finally {
        await recipientCtx.close()
      }
    } finally {
      await ownerCtx.close()
    }
  })
})
