import { test, expect, type Page } from '@playwright/test'
import { uploadTextFile, createShareLink, openRowMenu } from './helpers/drive'

/**
 * Task 0709 A+ — the "Manage shares" modal (ShareInfoModal) re-copy behavior.
 * With the dual-send live, a CURRENT share carries the owner-wrapped pair, so the
 * modal rebuilds a WORKING /s/<token>#key= link (canRebuild-gated Copy). A LEGACY
 * share (null owner_wrapped_*) falls back to the honest "key not stored" note —
 * never a keyless/wrong-key Copy. Both paths are covered here.
 *
 * Owner = the auto-logged-in dev account (authenticated project, vault unlocked).
 */

async function openManageShares(page: Page, filename: string) {
  await openRowMenu(page, filename)
  await page.getByRole('menuitem', { name: /^Manage shares/ }).click()
  const modal = page.getByRole('dialog', { name: /manage share links/i })
  await expect(modal).toBeVisible({ timeout: 15_000 })
  return modal
}

test('Manage shares: a current share shows a WORKING Copy (owner-wrapped pair present)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const filename = `siminfo-new-${Date.now()}.txt`
  await uploadTextFile(page, filename, 'share-info-modal lit-up test')
  await createShareLink(page, filename) // dual-send stores owner_wrapped_key + owner_wrapped_token

  const modal = await openManageShares(page, filename)
  // No honest-note fallback while the key can be rebuilt…
  await expect(modal.getByText(/the key for this link isn't stored here/i)).toHaveCount(0)
  // …a real Copy that rebuilds a valid /s/<token>#key= link for THIS share…
  const copyBtn = modal.getByRole('button', { name: /copy link/i }).first()
  await expect(copyBtn).toBeVisible({ timeout: 15_000 })
  await copyBtn.click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link, 'modal rebuilds a working /s/<token>#key= link').toMatch(/\/s\/[A-Za-z0-9_-]+#key=/)
  // …and Revoke still works.
  await expect(modal.getByRole('button', { name: /revoke/i }).first()).toBeVisible()
  await modal.screenshot({ path: 'test-results/0709-share-info-modal-lit.png' })
})

test('Manage shares: a LEGACY share (no owner-wrapped key) shows the honest note, no broken Copy', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const filename = `siminfo-legacy-${Date.now()}.txt`
  await uploadTextFile(page, filename, 'share-info-modal legacy test')
  await createShareLink(page, filename)

  // Simulate a pre-A+ (legacy) share: strip the owner-wrapped pair from
  // /shares/mine so canRebuildShareLink is false and the modal must fall back to
  // the honest note — never a keyless/wrong-key Copy.
  await page.route(/\/api\/v1\/shares\/mine/, async (route) => {
    const resp = await route.fetch()
    const body = await resp.json()
    if (Array.isArray(body?.shares)) {
      body.shares = body.shares.map((s: Record<string, unknown>) => ({
        ...s,
        owner_wrapped_key: null,
        owner_wrapped_token: null,
      }))
    }
    await route.fulfill({ response: resp, json: body })
  })

  const modal = await openManageShares(page, filename)
  await expect(modal.getByText(/the key for this link isn't stored here/i)).toBeVisible({ timeout: 15_000 })
  await expect(modal.getByRole('button', { name: /copy link/i })).toHaveCount(0)
  await expect(modal.getByRole('button', { name: /revoke/i }).first()).toBeVisible()
  await expect(modal.getByText(/never on our servers, and not here/i)).toBeVisible()
  await modal.screenshot({ path: 'test-results/0709-share-info-modal-legacy.png' })
})
