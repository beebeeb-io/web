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
    // Two full real E2EE uploads (client-side crypto + a persisted round trip
    // each), two real listVersions round trips, and a name-decrypt cycle
    // exceed the default 30s per-test budget (playwright.config.ts),
    // especially under load — 120s matches the convention used by the
    // heavier real-stack, multi-round-trip specs in this suite (e.g.
    // share-content-matrix.spec.ts, export-resume.spec.ts: 120_000).
    test.setTimeout(120_000)
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
    // Wait for the real FILE-LIST ROW, not the upload-progress card — the
    // card shows the plaintext filename optimistically the instant the picker
    // resolves (upload-progress-card.tsx renders `upload.name` directly), well
    // before the file exists server-side. The row (role="row" in
    // file-list.tsx) only gets the real name once `fetchFiles()` has pulled
    // the persisted file down AND file-list.tsx's decrypt effect has resolved
    // it into `decryptedNames` — the exact same state that then propagates to
    // drive.tsx's `externalDecryptedNames` (via onDecryptedNamesChange), which
    // is what the client-side conflict detector reads before the next
    // same-name upload. Waiting on this row is the real signal to wait for.
    // `networkidle` never resolves on this app (it holds an open SSE stream
    // for live sync, so the network is never idle) and a fixed sleep is a
    // guess, not a wait.
    await expect(
      page.getByRole('row').filter({ hasText: baseName }).first(),
    ).toBeVisible({ timeout: 30_000 })

    // ── Reload before re-uploading. Chasing this same-name re-upload landing
    //    as a second, unrelated file (two rows, same name, neither carrying a
    //    version badge) instead of a v2 auto-version led here — but the ACTUAL
    //    root cause was not a client-side timing race at all: src/lib/api.ts's
    //    initUpload() silently dropped `file_id` from the v2
    //    `/api/v1/uploads/init` request body (declared in its own param type,
    //    read by the server's InitUploadV2Request, just never wired into the
    //    JSON.stringify — fixed in this same PR). Without it the server always
    //    minted a fresh id, so every "replace" silently became a new file,
    //    no matter how long the client waited first. That fix alone made
    //    this test pass reliably. The reload stays as cheap, harmless
    //    defense-in-depth against the real (much smaller) gap between the row
    //    showing file-list.tsx's own `decryptedNames` and that same data
    //    propagating up to drive.tsx's `externalDecryptedNames`, which the
    //    conflict detector reads — a fresh mount settles both before the
    //    `toBeVisible` re-check below can pass.
    await page.reload()
    await expect(
      page
        .getByRole('heading', { name: 'All files', exact: true })
        .or(page.locator('#main-content, main, [role="main"]').getByText('All files').first()),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('row').filter({ hasText: baseName }).first(),
    ).toBeVisible({ timeout: 15_000 })

    // ── Re-upload the SAME name → server auto-versions directly, no dialog.
    //    drive.tsx's shouldAutoVersionUpload() only shows the conflict dialog
    //    when the existing and incoming MIME types are both known AND differ;
    //    ZK uploads store a NULL mime_type server-side (the server never
    //    learns the file's type — see api.ts's "ZK-uploaded files have null
    //    mime_type" note), and a `.bin` name doesn't resolve via
    //    inferMimeFromName either, so `existingMime` is always empty here and
    //    `sameType` is unconditionally true: this re-upload always takes the
    //    silent auto-version path (v2 is created, v1 becomes a restorable
    //    prior version) — there is no "Replace" button to click. ──────────
    await page.locator('input[type="file"]').first().setInputFiles({
      name: baseName,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0x05, 0x06, 0x07, 0x08, 0x09]),
    })
    // Wait for the real "Uploaded" toast (fired only once doEncryptedUpload's
    // completeUpload resolves) rather than a fixed sleep, so v2 is genuinely
    // persisted server-side before we open Version History. `.last()`, not
    // `.first()`: v1's own "Uploaded" toast (5s auto-dismiss, toast.tsx) can
    // still be on screen here, and new toasts are appended after existing
    // ones in the DOM, so the last match is always the newest — v2's.
    await expect(page.getByText('Uploaded', { exact: true }).last()).toBeVisible({ timeout: 20_000 })

    // Auto-version must land IN PLACE (same file id, version_number bumped) —
    // exactly one row for baseName, not two. A second, separate row here
    // means the client-side conflict detector missed the match (raced ahead
    // of `externalDecryptedNames`) and silently uploaded a duplicate instead
    // of a version — a real bug, not a UI nicety, so fail loudly on it rather
    // than let the rest of the test limp on to a confusing later failure.
    await expect(page.getByRole('row').filter({ hasText: baseName })).toHaveCount(1)

    // ── Select the file row (opens FileDetailsPanel). ────────────────────
    await page.getByText(baseName).first().click()

    // ── Switch to the Versions tab. ──────────────────────────────────────
    await page.getByRole('button', { name: 'Versions', exact: true }).click()

    // The real prior version must be listed — proves the claim below would
    // have been falsified by this exact screen's own data. The UI renders
    // "v1" (file-details-panel.tsx's VersionsTab: `v{v.version_number}`, no
    // "version" text) — match that, not a "version 1" phrase that never
    // appears on screen.
    await expect(page.getByText('v1', { exact: true }).first()).toBeVisible({ timeout: 10_000 })

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
