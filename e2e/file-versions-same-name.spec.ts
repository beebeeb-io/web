/**
 * Same-name re-upload must create a NEW VERSION of the existing file, not a
 * second file with the same name.
 *
 * Regression: drive.tsx correctly resolved the re-upload to the existing
 * file (auto-version path, `replaceFileId` = the existing id), but
 * `initUpload()`'s v2 body dropped `file_id`, so the server never learned
 * which file was being replaced and inserted a brand-new row under a fresh
 * server id — two "notes.txt" rows, no version history. The explicit
 * conflict-dialog "Replace — creates a new version" choice went through the
 * same call and had the same effect.
 *
 * Real stack (run via e2e/scripts/web-e2e.sh). Asserts, through the browser:
 *   1. exactly ONE "notes.txt" row after the second upload,
 *   2. "See versions" lists 2 versions,
 *   3. downloading the current file yields the v2 bytes,
 *   4. downloading the older version yields the v1 bytes.
 */
import { test, expect, type Page, type Download } from '@playwright/test'
import * as fs from 'fs'
import { signupAndUnlock } from './helpers/signup'
import { openRowMenu } from './helpers/drive'

test.use({ storageState: { cookies: [], origins: [] } })

const NAME = 'notes.txt'
const V1 = 'version one'
const V2 = 'version TWO, longer body'

async function dismissFirstRunOverlays(page: Page): Promise<void> {
  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()
  const skip = page.getByRole('button', { name: /^Skip for now$/ })
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) await skip.click()
}

async function uploadNotes(page: Page, content: string): Promise<void> {
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: NAME,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  })
}

async function readDownload(download: Download): Promise<string> {
  const p = await download.path()
  expect(p, 'download produced no file').toBeTruthy()
  return fs.readFileSync(p!, 'utf-8')
}

test('same-name re-upload becomes version 2 of the same file, with both versions downloadable', async ({ page }) => {
  test.setTimeout(180_000)

  // Disable DevAuthGate's dev auto-login for this tab (src/lib/dev-auth.ts),
  // otherwise it can race /signup and land us in the shared dev vault instead
  // of a fresh account (observed: /signup rendered "Dev's vault", no email field).
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { password: 'Versions-correct-horse-9' })
  await dismissFirstRunOverlays(page)
  // The first-run coachmark tour ("Upload your first file", 1 / 2) opens
  // asynchronously and floats above the Version history panel, intercepting
  // clicks on the version options. Skip it whenever it shows up.
  await page.addLocatorHandler(
    page.getByRole('dialog', { name: 'Upload your first file' }),
    async (tour) => {
      await tour.getByRole('button', { name: 'Skip tour' }).click()
    },
  )

  const rows = page.getByRole('row').filter({ hasText: NAME })

  // v1
  await uploadNotes(page, V1)
  await expect(rows).toHaveCount(1, { timeout: 60_000 })
  await expect(rows.first()).toContainText('11 B', { timeout: 30_000 })

  // v2 — same name, different content: auto-version path.
  await uploadNotes(page, V2)
  await expect(rows.first()).toContainText(`${Buffer.byteLength(V2)} B`, { timeout: 60_000 })
  // Let any stray second row (the bug) land before counting.
  await page.waitForLoadState('networkidle')
  await expect(rows).toHaveCount(1)

  // Current download = v2 bytes.
  await openRowMenu(page, NAME)
  const [currentDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('menuitem', { name: /^Download/ }).click(),
  ])
  expect(await readDownload(currentDl)).toBe(V2)

  // Version history lists 2 versions.
  await openRowMenu(page, NAME)
  await page.getByRole('menuitem', { name: /^See versions/ }).click()
  const panel = page.getByRole('dialog', { name: 'Version history' })
  await expect(panel).toBeVisible()
  const options = panel.getByRole('option')
  await expect(options).toHaveCount(2, { timeout: 15_000 })
  await expect(panel).toContainText('current v2')

  // The older version (v1) downloads as the v1 bytes.
  const v1Option = panel.getByRole('option', { name: /^Version 1,/ })
  await v1Option.click()
  const [v1Dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    v1Option.getByRole('button', { name: 'Download' }).click(),
  ])
  expect(v1Dl.suggestedFilename()).toBe('notes_v1.txt')
  expect(await readDownload(v1Dl)).toBe(V1)
})
