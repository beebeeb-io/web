/**
 * Task 1809 — a kept version can be deleted from the file's version list.
 *
 * Real stack (run via e2e/scripts/web-e2e.sh against a server built from the
 * 1809 branch; the second test needs `BB_ENTRY_ALLOWANCE_BYTES=770`: a new account
 * holds the 440-byte welcome file, three 100-byte versions put it at 740, and a
 * fourth 128-byte upload does not fit until a version is deleted):
 *
 *   E2E_API_BIN=<server>/target/debug/beebeeb-api BB_ENTRY_ALLOWANCE_BYTES=770 \
 *   E2E_EVIDENCE_DIR=<abs path> E2E_API_PORT=… E2E_VITE_PORT=… E2E_DB_NAME=… \
 *   ./e2e/scripts/web-e2e.sh e2e/1809-version-delete.spec.ts
 *
 * Test 1 (an account on a plan): Versions tab and full-history drawer offer Delete on
 *   every kept version and never on the current one; the confirmation says the truth
 *   for a plan (versions are not counted against its storage); the delete removes the
 *   row, the server row and the version list entry; the current version is refused
 *   by the API with 409 even when asked directly.
 * Test 2 (an entry-allowance account at its limit): the shown bytes are the bytes
 *   freed — `used_bytes` drops by exactly the figure on screen, and the upload that
 *   was refused before is accepted after.
 *
 * Declared shim (test 2 only): today the web gates an account whose legacy
 * `account_state` is `needs_plan` (which an allowance account is) to /choose-plan, so
 * its drive cannot be opened at all. The spec rewrites ONLY that one field of the
 * `GET /billing/subscription` response to reach the drive; every version, upload and
 * usage call below goes to the real server unmodified.
 */
import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'

test.use({ storageState: { cookies: [], origins: [] } })

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1809'
const ALLOWANCE = Number(process.env.BB_ENTRY_ALLOWANCE_BYTES ?? '0')
/** What the allowance test is sized for: welcome file 440 + notes.txt 100 + two kept versions 200 = 740. */
const ALLOWANCE_UNDER_TEST = 770
/** A .bin is not previewable, so a row click opens the details panel (a .txt opens the preview). */
const NAME = 'notes.bin'
/** 100 plaintext bytes per version = 128 encrypted (one chunk + 28 bytes of AEAD framing). */
const body = (ch: string) => ch.repeat(100)

function psql(statement: string): string {
  const db = process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'
  const port = process.env.E2E_PG_PORT ?? '5434'
  const url = `postgres://beebeeb:beebeeb_dev@localhost:${port}/${db}`
  try {
    return execFileSync('psql', [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe' }).toString().trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const container = process.env.E2E_PG_CONTAINER ?? 'beebeebio-postgres-1'
    return execFileSync(
      'docker',
      ['exec', '-e', 'PGPASSWORD=beebeeb_dev', container, 'psql', '-U', 'beebeeb', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement],
      { stdio: 'pipe' },
    ).toString().trim()
  }
}

const userId = (email: string) => `(SELECT id FROM users WHERE email = '${email}')`
const fileRow = (email: string) =>
  `SELECT id FROM files WHERE user_id = ${userId(email)} AND is_folder = FALSE AND size_bytes = 100 AND is_uploading = FALSE LIMIT 1`

async function uploadVersion(page: Page, email: string, content: string, expectVersion: number): Promise<void> {
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: NAME,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(content),
  })
  await expect
    .poll(
      () => psql(`SELECT version_number FROM files WHERE user_id = ${userId(email)} AND is_folder = FALSE AND size_bytes = 100 AND is_uploading = FALSE`),
      { timeout: 60_000, message: `version ${expectVersion} should land` },
    )
    .toBe(String(expectVersion))
}

async function usage(page: Page): Promise<{ used: number; quota: number }> {
  const res = await page.request.get(`${API_URL}/api/v1/billing/usage`)
  expect(res.status(), await res.text()).toBe(200)
  const j = (await res.json()) as { used_bytes: number; quota_bytes: number }
  return { used: j.used_bytes, quota: j.quota_bytes }
}

async function dismissOverlays(page: Page): Promise<void> {
  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()
  const skip = page.getByRole('button', { name: /^Skip for now$/ })
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) await skip.click()
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Upload your first file' }), async (tour) => {
    await tour.getByRole('button', { name: 'Skip tour' }).click()
  })
  // The welcome checklist opens late (after a preferences round trip) and covers the list.
  await page.addLocatorHandler(page.getByRole('button', { name: /^Skip for now$/ }), async (skipBtn) => {
    await skipBtn.click()
  })
}

async function openVersionsTab(page: Page): Promise<void> {
  // The file row (100 B); a failed-upload card for the same name may sit above it.
  await page.getByRole('row').filter({ hasText: '100 B' }).first().click()
  await page.getByRole('button', { name: 'Versions', exact: true }).click()
  await expect(page.getByTestId('version-row-1')).toBeVisible({ timeout: 15_000 })
}

test('an account on a plan: Delete is offered on kept versions only, says the truth, and removes the version', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/?nodev=1')
  const { email } = await signupAndUnlock(page, { email: uniqueEmail('v1809a'), password: 'Versions-correct-horse-9' })
  await dismissOverlays(page)

  await uploadVersion(page, email, body('a'), 1)
  await uploadVersion(page, email, body('b'), 2)
  await uploadVersion(page, email, body('c'), 3)
  const fileId = psql(fileRow(email))
  expect(fileId).toMatch(/^[0-9a-f-]{36}$/)
  expect(psql(`SELECT COUNT(*) FROM object_versions WHERE file_id = '${fileId}'`)).toBe('3')

  await openVersionsTab(page)
  const row1 = page.getByTestId('version-row-1')
  const row2 = page.getByTestId('version-row-2')
  const row3 = page.getByTestId('version-row-3')

  // The row shows the CONTENT size (100 B), not the 128 encrypted bytes.
  await expect(row1).toContainText('100 B')
  // The current version is labelled and has no Delete; the kept ones have it.
  await expect(row3).toContainText('Current')
  await expect(row3.getByRole('button', { name: /^Delete version/ })).toHaveCount(0)
  await expect(row1.getByRole('button', { name: 'Delete version 1' })).toBeVisible()
  await expect(row2.getByRole('button', { name: 'Delete version 2' })).toBeVisible()
  await page.screenshot({ path: `${EVIDENCE}/plan-01-versions-tab.png` })

  // Confirmation: honest copy for a plan (versions are not counted), no promise of space.
  await row1.getByRole('button', { name: 'Delete version 1' }).click()
  const confirm = page.getByRole('group', { name: 'Delete version 1?' })
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText("We can't recover it.")
  await expect(confirm).toContainText("Versions are not counted against your plan's storage, so your storage total will not change.")
  await expect(confirm).not.toContainText('gives that space back')
  await page.screenshot({ path: `${EVIDENCE}/plan-02-confirm.png` })

  // Cancel changes nothing.
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  expect(psql(`SELECT COUNT(*) FROM object_versions WHERE file_id = '${fileId}'`)).toBe('3')

  // Confirm: row and server row go; the toast says so.
  await row1.getByRole('button', { name: 'Delete version 1' }).click()
  await page.getByRole('group', { name: 'Delete version 1?' }).getByRole('button', { name: 'Delete version' }).click()
  await expect(page.getByText('Version 1 deleted')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('version-row-1')).toHaveCount(0)
  await expect(page.getByTestId('version-row-2')).toBeVisible()
  expect(psql(`SELECT COUNT(*) FROM object_versions WHERE file_id = '${fileId}'`)).toBe('2')
  await page.screenshot({ path: `${EVIDENCE}/plan-03-after-delete.png` })

  // The full-history drawer: same rule (current has no Delete), same confirmation.
  await page.getByRole('button', { name: /full version history/i }).click()
  const drawer = page.getByRole('dialog', { name: 'Version history' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('option')).toHaveCount(2)
  const cur = drawer.getByRole('option', { name: /^Version 3,/ })
  await cur.click()
  await expect(cur.getByRole('button', { name: 'Download' })).toBeVisible()
  await expect(cur.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  const kept = drawer.getByRole('option', { name: /^Version 2,/ })
  await kept.click()
  await kept.getByRole('button', { name: 'Delete' }).click()
  const dConfirm = drawer.getByRole('group', { name: 'Delete version 2?' })
  await expect(dConfirm).toContainText("We can't recover it.")
  await page.screenshot({ path: `${EVIDENCE}/plan-04-drawer-confirm.png` })
  await dConfirm.getByRole('button', { name: 'Delete version' }).click()
  await expect(drawer.getByRole('option')).toHaveCount(1, { timeout: 15_000 })
  expect(psql(`SELECT COUNT(*) FROM object_versions WHERE file_id = '${fileId}'`)).toBe('1')

  // Asked directly, the API refuses to delete the current version (409), and nothing changes.
  const current = psql(`SELECT current_object_version_id FROM files WHERE id = '${fileId}'`)
  const res = await page.request.delete(`${API_URL}/api/v1/files/${fileId}/versions/${current}`)
  expect(res.status(), await res.text()).toBe(409)
  expect(((await res.json()) as { error: string }).error).toBe('cannot_delete_current_version')
  expect(psql(`SELECT COUNT(*) FROM object_versions WHERE file_id = '${fileId}'`)).toBe('1')
})

test('an allowance account at its limit: the bytes shown are the bytes freed, and the refused upload is then accepted', async ({ page }) => {
  test.skip(ALLOWANCE !== ALLOWANCE_UNDER_TEST, 'needs the API started with BB_ENTRY_ALLOWANCE_BYTES=770')
  test.setTimeout(300_000)

  // Declared shim: reach the drive despite `needs_plan` (see the file header). Only that field.
  await page.route('**/api/v1/billing/subscription', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch()
    const json = (await res.json()) as Record<string, unknown>
    if (json.account_state === 'needs_plan') json.account_state = 'active'
    return route.fulfill({ response: res, json })
  })

  await page.goto('/?nodev=1')
  const { email } = await signupAndUnlock(page, { email: uniqueEmail('v1809b'), password: 'Versions-correct-horse-9' })
  await dismissOverlays(page)

  // Three versions while the account is still on its starting plan (a version is 100 content bytes).
  await uploadVersion(page, email, body('a'), 1)
  await uploadVersion(page, email, body('b'), 2)
  await uploadVersion(page, email, body('c'), 3)
  const fileId = psql(fileRow(email))

  // Now the account is plan-less and verified: the entry allowance applies.
  psql(`UPDATE users SET plan_required = TRUE, email_verified = TRUE WHERE email = '${email}'`)
  const atLimit = await usage(page)
  expect(atLimit.quota, 'the allowance is the quota').toBe(ALLOWANCE)
  const welcome = Number(psql(`SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE user_id = ${userId(email)} AND id <> '${fileId}'`))
  expect(welcome, 'the welcome file is the only other file').toBeGreaterThan(0)
  expect(atLimit.used, 'welcome file + current 100 + kept versions 100 + 100').toBe(welcome + 300)
  expect(ALLOWANCE - atLimit.used, 'a 128-byte upload does not fit').toBeLessThan(128)
  expect(ALLOWANCE - (atLimit.used - 100), 'it fits once 100 bytes are freed').toBeGreaterThanOrEqual(128)

  // The next version is refused (413) while the account holds three.
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: NAME,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(body('d')),
  })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2_000)
  expect(psql(`SELECT version_number FROM files WHERE id = '${fileId}'`), 'refused: still version 3').toBe('3')
  expect((await usage(page)).used).toBe(atLimit.used)
  await expect(page.getByText('Upload failed')).toBeVisible()
  await page.screenshot({ path: `${EVIDENCE}/allowance-00-upload-refused-at-limit.png` })
  await page.getByText('Cancel', { exact: true }).first().click().catch(() => {})

  // Delete the oldest kept version from the file's version list.
  await openVersionsTab(page)
  const row1 = page.getByTestId('version-row-1')
  await expect(row1).toContainText('100 B')
  await row1.getByRole('button', { name: 'Delete version 1' }).click()
  const confirm = page.getByRole('group', { name: 'Delete version 1?' })
  await expect(confirm).toContainText('This removes version 1 (100 B) for good and gives that space back to your storage.')
  await expect(confirm).toContainText("We can't recover it.")
  await page.screenshot({ path: `${EVIDENCE}/allowance-01-confirm-at-limit.png` })
  await confirm.getByRole('button', { name: 'Delete version' }).click()
  await expect(page.getByText('Version 1 deleted')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('version-row-1')).toHaveCount(0)

  // The shown 100 B is exactly what came back.
  const after = await usage(page)
  expect(atLimit.used - after.used, 'freed bytes == the figure on screen (100)').toBe(100)
  expect(after.used).toBe(atLimit.used - 100)
  await page.screenshot({ path: `${EVIDENCE}/allowance-02-after-delete.png` })

  // The same upload that was refused is accepted now.
  await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
  await uploadVersion(page, email, body('d'), 4)
  expect((await usage(page)).used, 'back at welcome + 300').toBe(atLimit.used)
  expect(psql(`SELECT COUNT(*) FROM object_versions WHERE file_id = '${fileId}'`)).toBe('3')
  await page.screenshot({ path: `${EVIDENCE}/allowance-03-upload-accepted.png` })
})
