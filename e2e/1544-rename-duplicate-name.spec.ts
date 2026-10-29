/**
 * Task 1544 finding 3: renaming a file into an already-used sibling name
 * silently succeeded, creating two files with the same DECRYPTED name in
 * one folder. drive.tsx's buildNameToFileMap() then resolved the resulting
 * ambiguity by silently picking whichever file iterated last, so a later
 * same-name re-upload's auto-version could attach to the WRONG file.
 *
 * Fix: the rename dialog now blocks a rename into an existing sibling name
 * with an inline error and a disabled submit button (rename-dialog.tsx +
 * src/lib/name-collision.ts). This spec drives the real dialog through the
 * browser and confirms the duplicate is refused, not just logged.
 *
 * Real stack (run via e2e/scripts/web-e2e.sh).
 */
import { test, expect, type Page } from '@playwright/test'
import { signupAndUnlock } from './helpers/signup'
import { uploadTextFile, openRowMenu } from './helpers/drive'

test.use({ storageState: { cookies: [], origins: [] } })

/**
 * Dismiss the two first-run overlays that stack on a brand-new account and
 * would otherwise intercept pointer events on the file rows: the cookie
 * banner, then the welcome checklist (welcome-tour.tsx: a
 * `fixed inset-0 z-50` modal, "Skip for now" until every step is done).
 */
async function dismissFirstRunOverlays(page: Page): Promise<void> {
  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()

  const skip = page.getByRole('button', { name: /^Skip for now$/ })
  const appeared = await skip.isVisible({ timeout: 5_000 }).catch(() => false)
  if (appeared) await skip.click()
}

test('1544: rename into an existing sibling name is blocked, not silently applied', async ({ page }) => {
  // Signup + vault-unlock (Argon2id/OPAQUE) + two uploads + a possible
  // welcome-tour dismiss retry (openRowMenu, helpers/drive.ts) comfortably
  // exceed the project's 30s default under real load — matches the
  // precedent in refresh-stability.spec.ts for the same signup-heavy shape.
  test.setTimeout(60_000)
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { password: 'RenameCollision1544!' })
  await dismissFirstRunOverlays(page)

  // Two files, deliberately different names.
  await uploadTextFile(page, 'report.pdf', 'content A')
  await uploadTextFile(page, 'other.pdf', 'content B')

  // Open "other.pdf"'s context menu and start a rename.
  await openRowMenu(page, 'other.pdf')
  await page.getByRole('menuitem', { name: 'Rename' }).click()

  const dialog = page.getByRole('dialog', { name: 'Rename' })
  await expect(dialog).toBeVisible()
  const input = dialog.locator('input')
  await input.fill('report.pdf')

  // Blocked: inline error shown, submit disabled. Longer timeout than the
  // 5s default — this is a synchronous render off local state (no network),
  // but under real load the paint can lag past 5s (observed: one retry
  // needed on a heavily-loaded box, 2026-09-25).
  await expect(dialog.getByText('A file named "report.pdf" already exists here.')).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByRole('button', { name: 'Rename' })).toBeDisabled({ timeout: 15_000 })

  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()

  // No duplicate was created: exactly one row still reads "report.pdf",
  // and "other.pdf" is unchanged.
  await expect(page.getByText('report.pdf', { exact: false })).toHaveCount(1)
  await expect(page.getByText('other.pdf', { exact: false })).toHaveCount(1)
})

test('1544: renaming to a genuinely free name still works', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { password: 'RenameFreeName1544!' })
  await dismissFirstRunOverlays(page)

  await uploadTextFile(page, 'draft.pdf', 'content A')

  await openRowMenu(page, 'draft.pdf')
  await page.getByRole('menuitem', { name: 'Rename' }).click()

  const dialog = page.getByRole('dialog', { name: 'Rename' })
  const input = dialog.locator('input')
  await input.fill('final.pdf')
  await expect(dialog.getByRole('button', { name: 'Rename' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Rename' }).click()

  await expect(page.getByText('final.pdf', { exact: false }).first()).toBeVisible({ timeout: 10_000 })
})
