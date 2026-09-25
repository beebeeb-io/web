import { type Page, expect } from '@playwright/test'

/**
 * Dismiss the welcome-tour checklist (welcome-tour.tsx) if it happens to be
 * open right now. Returns whether it was found and dismissed.
 *
 * Task 1544: the row hover TARGET below was never wrong (it resolves to the
 * right `role="row"` element every time) — the welcome tour is. Its `open`
 * state only flips true once `GET /api/v1/preferences/welcome_tour`
 * resolves, a real network round trip that races signup + vault-unlock's
 * own Argon2id/OPAQUE work and can land well AFTER first paint. A one-shot,
 * fixed-timeout dismissal at the top of a spec (dismissFirstRunOverlays in
 * the 1544 spec) can simply be too early to catch it — it shows up later,
 * mid-test, its `fixed inset-0 z-50 …` overlay covering the row, and
 * Playwright's actionability check reports "…subtree intercepts pointer
 * events" and spins for the rest of the test's timeout budget.
 */
async function dismissWelcomeTourIfOpen(page: Page): Promise<boolean> {
  const dismiss = page.getByRole('button', { name: /^(Skip for now|Close)$/ })
  const visible = await dismiss.first().isVisible({ timeout: 1_000 }).catch(() => false)
  if (!visible) return false
  await dismiss.first().click()
  await dismiss.first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  return true
}

/**
 * Open a file row's action menu via the "File actions" kebab (revealed on hover).
 * The kebab fires the SAME context menu as right-click but through a real click —
 * synthetic `contextmenu` events do not trigger the row handler under Playwright.
 * Scoped to the row owning `filename`.
 *
 * Waits on real UI state rather than a fixed dismiss-once-and-hope: if the
 * welcome tour is (or becomes) the thing blocking the hover, dismiss it and
 * retry, bounded to a few attempts — see dismissWelcomeTourIfOpen above.
 */
export async function openRowMenu(page: Page, filename: string): Promise<void> {
  const rowEl = page
    .getByText(filename, { exact: false })
    .first()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')

  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rowEl.hover({ timeout: 8_000 })
      await rowEl.getByRole('button', { name: 'File actions' }).click()
      return
    } catch (err) {
      const dismissed = await dismissWelcomeTourIfOpen(page)
      if (!dismissed || attempt === maxAttempts) throw err
    }
  }
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
