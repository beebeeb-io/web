import { test, expect } from '@playwright/test'
import { uploadTextFile, createShareLink, openRowMenu } from './helpers/drive'

/**
 * Task 0709 A+ — the re-copy surfaces (SharePopover + /shared) must NOT copy the
 * keyless/wrong-key share.url. With owner_wrapped_* absent (graceful absence,
 * pre-server), both show the honest "the key for this link isn't stored here" UX
 * and offer no broken Copy. (They light up once the owner-wrapped pair lands.)
 */
test('SharePopover + /shared show the honest "key not stored" note (graceful absence)', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const filename = `recopy-${Date.now()}.txt`
  await uploadTextFile(page, filename, 'recopy surfaces honest-UX test')
  await createShareLink(page, filename) // create a share so both surfaces have one

  // The dialog's onShareCreated is a no-op, so the drive's share_count doesn't
  // refresh in-place — reload so the file row renders its share badge.
  await page.reload()
  await expect(page.getByText(filename, { exact: false }).first()).toBeVisible({ timeout: 30_000 })

  // ── SharePopover: the file's share badge → popover shows the honest note ──
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
  await expect(popover.getByText(/the key for this link isn't stored here/i)).toBeVisible()
  // No broken "Copy link" affordance while the key can't be rebuilt.
  await expect(popover.getByRole('button', { name: /copy link/i })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // ── /shared "by me": expand the share row → honest note, no keyless copy ──
  await page.goto('/shared?tab=by-me')
  const shareRow = page.getByText(filename, { exact: false }).first()
  await expect(shareRow).toBeVisible({ timeout: 20_000 })
  await shareRow.click() // expand the insights panel
  await expect(page.getByText(/the key for this link isn't stored here/i).first()).toBeVisible({ timeout: 10_000 })

  await page.screenshot({ path: 'test-results/0709-recopy-surfaces.png', fullPage: false })
})
