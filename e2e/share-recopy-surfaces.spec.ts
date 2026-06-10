import { test, expect } from '@playwright/test'
import { uploadTextFile, createShareLink } from './helpers/drive'

/**
 * Task 0709 A+ — the re-copy surfaces (SharePopover + /shared) must rebuild a
 * WORKING /s/<token>#key=<K_c> link from the owner-wrapped pair, never the
 * keyless/wrong-key share.url. With the dual-send live (owner_wrapped_* present),
 * both light up with a real "Copy link"; the honest "key not stored" note is the
 * legacy-null fallback (not reachable in the fresh harness, where every share
 * carries the wrapped pair). The /shared round-trip is covered in
 * share-content-matrix; here we assert SharePopover lights up + copies a valid link.
 */
test('SharePopover + /shared light up with a working Copy (owner-wrapped pair present)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const filename = `recopy-${Date.now()}.txt`
  await uploadTextFile(page, filename, 'recopy surfaces lit-up test')
  await createShareLink(page, filename) // dual-send stores owner_wrapped_key + owner_wrapped_token

  // The dialog's onShareCreated is a no-op, so the drive's share_count doesn't
  // refresh in-place — reload so the file row renders its share badge.
  await page.reload()
  await expect(page.getByText(filename, { exact: false }).first()).toBeVisible({ timeout: 30_000 })

  // ── SharePopover: badge → popover → real Copy (no honest note) → valid link ──
  const row = page
    .getByText(filename, { exact: false })
    .first()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')
  await row.hover()
  const badge = row.getByRole('button', { name: /active share link/i })
  await expect(badge).toBeVisible({ timeout: 15_000 })
  await badge.click()

  const popover = page.getByRole('dialog', { name: /active share links/i })
  await expect(popover).toBeVisible({ timeout: 10_000 })
  await expect(popover.getByText(/the key for this link isn't stored here/i)).toHaveCount(0)
  const copyBtn = popover.getByRole('button', { name: /copy link/i })
  await expect(copyBtn).toBeVisible({ timeout: 10_000 })
  await copyBtn.click()
  const popoverLink = await page.evaluate(() => navigator.clipboard.readText())
  expect(popoverLink, 'SharePopover rebuilds a working /s/<token>#key= link').toMatch(/\/s\/[A-Za-z0-9_-]+#key=/)
  await page.keyboard.press('Escape')

  // ── /shared "by me": expand the share row → real Copy, no honest note ──
  await page.goto('/shared?tab=by-me')
  const shareRow = page.getByText(filename, { exact: false }).first()
  await expect(shareRow).toBeVisible({ timeout: 20_000 })
  await shareRow.click() // expand the insights panel
  await expect(page.getByText(/the key for this link isn't stored here/i).first()).toHaveCount(0)
  await expect(page.getByRole('button', { name: /copy link/i }).first()).toBeVisible({ timeout: 10_000 })

  await page.screenshot({ path: 'test-results/0709-recopy-surfaces.png', fullPage: false })
})
