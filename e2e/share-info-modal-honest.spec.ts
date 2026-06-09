import { test, expect, type Page } from '@playwright/test'

/** Open a file row's action menu via the "File actions" kebab (revealed on
 *  hover). The kebab fires the SAME context menu as right-click but through a
 *  real click, which is reliable under Playwright (synthetic contextmenu events
 *  do not trigger the row handler here). Scoped to the row owning `filename`. */
async function openRowMenu(page: Page, filename: string): Promise<void> {
  const rowEl = page
    .getByText(filename, { exact: false })
    .first()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')
  await rowEl.hover()
  await rowEl.getByRole('button', { name: 'File actions' }).click()
}

/**
 * Task 0709 (immediate first commit) — the "Manage shares" modal must NOT hand
 * out a broken link. It used to rebuild `#key=` from the FILE KEY (wrong key for
 * double-encrypted shares) and toast "Includes the decryption key" — confidently
 * wrong. That copy path is removed; the modal now states the situation honestly.
 *
 * Owner = the auto-logged-in dev account (authenticated project, vault unlocked).
 */
test('Manage shares modal shows honest "key not stored" copy, no broken Copy link (0709)', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // Upload a file so we have something to share.
  const filename = `siminfo-${Date.now()}.txt`
  await page.locator('input[type="file"]').first().setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from('share-info-modal honest-copy test'),
  })
  const row = page.getByText(filename, { exact: false }).first()
  await expect(row).toBeVisible({ timeout: 60_000 })

  // Create a share via the kebab menu → "Share" → Generate encrypted link, then close.
  // Menuitem accessible names include the keyboard-shortcut <kbd> (e.g. "Share S"),
  // so anchor on the start of the label. "Manage shares" has no shortcut.
  await openRowMenu(page, filename)
  await page.getByRole('menuitem', { name: /^Share/ }).click()
  await page.getByRole('button', { name: /generate encrypted link/i }).click()
  await expect(page.locator('input[readonly]').first()).toBeVisible({ timeout: 25_000 })
  await page.keyboard.press('Escape')

  // Open "Manage shares" (ShareInfoModal) on the same file.
  await openRowMenu(page, filename)
  await page.getByRole('menuitem', { name: /^Manage shares/ }).click()
  const modal = page.getByRole('dialog', { name: /manage share links/i })
  await expect(modal).toBeVisible({ timeout: 15_000 })

  // The honest legacy message is shown for the existing share…
  await expect(modal.getByText(/The key for this link isn't stored here/i)).toBeVisible({ timeout: 15_000 })
  // …there is NO "Copy link" affordance handing out a broken/keyless link…
  await expect(modal.getByRole('button', { name: /copy link/i })).toHaveCount(0)
  // …Revoke still works, and the footer copy is honest (not the old false claim).
  await expect(modal.getByRole('button', { name: /revoke/i }).first()).toBeVisible()
  await expect(modal.getByText(/never on our servers, and not here/i)).toBeVisible()

  await modal.screenshot({ path: 'test-results/0709-share-info-modal-honest.png' })
})
