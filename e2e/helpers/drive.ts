import { type Page, expect } from '@playwright/test'

/**
 * Open a file row's action menu via the "File actions" kebab (revealed on hover).
 * The kebab fires the SAME context menu as right-click but through a real click —
 * synthetic `contextmenu` events do not trigger the row handler under Playwright.
 * Scoped to the row owning `filename`.
 */
export async function openRowMenu(page: Page, filename: string): Promise<void> {
  const rowEl = page
    .getByText(filename, { exact: false })
    .first()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')
  await rowEl.hover()
  await rowEl.getByRole('button', { name: 'File actions' }).click()
}

/** Upload a text file to the drive and wait for its row to appear. */
export async function uploadTextFile(page: Page, filename: string, content: string): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  })
  await expect(page.getByText(filename, { exact: false }).first()).toBeVisible({ timeout: 60_000 })
}

/**
 * Create a share link for `filename` via the share dialog and return the full
 * `/s/<token>#key=…` URL (the "Full link" tab — the only surface that embeds the
 * decryption key, since K_c is not persisted server-side until 0709 A+ lands).
 */
export async function createShareLink(
  page: Page,
  filename: string,
  opts: { passphrase?: string } = {},
): Promise<string> {
  await openRowMenu(page, filename)
  await page.getByRole('menuitem', { name: /^Share/ }).click()
  if (opts.passphrase) {
    // The toggle's checkbox is sr-only (the visible control is the label) —
    // force past the visibility check; React's onChange still fires.
    await page.getByRole('checkbox', { name: /require password/i }).check({ force: true })
    await page.locator('#share-passphrase').fill(opts.passphrase)
  }
  await page.getByRole('button', { name: /generate encrypted link/i }).click()
  await page.getByRole('button', { name: 'Full link', exact: true }).click()
  const url = await page
    .locator('input[readonly]')
    .evaluateAll((els) => (els as HTMLInputElement[]).find((e) => /\/s\/[^#]+#key=/.test(e.value))?.value ?? null)
  if (!url) throw new Error('share dialog did not surface a /s/<token>#key=… URL')
  await page.keyboard.press('Escape')
  return url
}
