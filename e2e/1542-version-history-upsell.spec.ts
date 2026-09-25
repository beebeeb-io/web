import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * 1542, finding 4 — VersionHistory's "Free keeps the current version only"
 * upsell claim is false. Real-stack e2e (dev auto-auth, real backend, real
 * encrypted upload): re-upload a file with the same name to create a real,
 * restorable version 2 on a free-plan (no-subscription) dev account, open
 * Version History, and confirm:
 *   (a) the false upsell copy never renders
 *   (b) the real prior version IS shown (proving the claim was falsified by
 *       the screen's own data, not just absent by coincidence)
 *
 * Run: ./e2e/scripts/web-e2e.sh e2e/1542-version-history-upsell.spec.ts
 */
test.describe('1542 finding 4 — version history upsell copy', () => {
  let tmpFile: string
  const baseName = `bb-1542-versions-${Date.now()}.bin`

  test.beforeAll(() => {
    tmpFile = path.join(os.tmpdir(), baseName)
    fs.writeFileSync(tmpFile, Buffer.from([0x01, 0x02, 0x03, 0x04]))
  })

  test.afterAll(() => {
    try {
      fs.unlinkSync(tmpFile)
    } catch {
      /* ignore */
    }
  })

  test('no false "Free keeps the current version only" claim, and the real prior version IS shown', async ({ page }) => {
    await page.goto('/')

    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active')
    }

    await expect(
      page
        .getByRole('heading', { name: 'All files', exact: true })
        .or(page.locator('#main-content, main, [role="main"]').getByText('All files').first()),
    ).toBeVisible({ timeout: 10_000 })

    // ── Upload v1 (application/octet-stream — never previewable, so a later
    //    row click selects the file for the details panel instead of opening
    //    the preview pane). ──────────────────────────────────────────────
    await page.locator('input[type="file"]').first().setInputFiles({
      name: baseName,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0x01, 0x02, 0x03, 0x04]),
    })
    await expect(page.getByText(baseName).first()).toBeVisible({ timeout: 30_000 })
    // The row's text appears as soon as the upload card shows it optimistically,
    // but drive.tsx's client-side name-conflict detector needs the file's name
    // to finish decrypting into `externalDecryptedNames` (a separate, slightly
    // later async step) before it will recognize the next same-name upload as a
    // conflict — wait for that to settle.
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    // ── Re-upload the SAME name → conflict dialog → Replace (server
    //    auto-versions: v2 is created, v1 becomes a restorable prior
    //    version). ─────────────────────────────────────────────────────
    await page.locator('input[type="file"]').first().setInputFiles({
      name: baseName,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0x05, 0x06, 0x07, 0x08, 0x09]),
    })
    await page.getByRole('button', { name: /^Replace$/ }).click({ timeout: 15_000 })
    // Wait for the real "Uploaded" toast (fired only once doEncryptedUpload's
    // completeUpload resolves) rather than a fixed sleep, so v2 is genuinely
    // persisted server-side before we open Version History.
    await expect(page.getByText('Uploaded', { exact: true }).first()).toBeVisible({ timeout: 20_000 })

    // ── Select the file row (opens FileDetailsPanel). ────────────────────
    await page.getByText(baseName).first().click()

    // ── Switch to the Versions tab. ──────────────────────────────────────
    await page.getByRole('button', { name: 'Versions', exact: true }).click()

    // The real prior version must be listed — proves the claim below would
    // have been falsified by this exact screen's own data.
    await expect(page.getByText(/version\s*1/i).first()).toBeVisible({ timeout: 10_000 })

    // ── Open the full VersionHistory overlay. ────────────────────────────
    await page.getByRole('button', { name: /full version history/i }).click()
    await expect(page.getByRole('heading', { name: /version history/i }).or(
      page.getByText(baseName).last(),
    )).toBeVisible({ timeout: 10_000 })

    // ── GATE — the false upsell claim must never appear anywhere on
    //    either surface (Versions tab or the full-history overlay). ──────
    await expect(page.getByText(/Free keeps the current version only/i)).toHaveCount(0)
    await expect(page.getByText(/Basic keeps 30 days of version history/i)).toHaveCount(0)

    await page.screenshot({ path: 'e2e/screenshots/1542-version-history-no-false-upsell.png', fullPage: true })
  })
})
