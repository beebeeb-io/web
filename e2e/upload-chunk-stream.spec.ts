import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Streaming-encryptor upload E2E (task: web chunk-stream adoption).
 *
 * Exercises the WASM `WasmChunkEncryptor` push-form path end-to-end in a real
 * browser: the upload loop in `src/lib/encrypted-upload.ts` creates a
 * worker-owned encryptor, slices the file, calls `pushChunk` per slice, PUTs
 * each returned `nonce||ciphertext||tag` frame, and runs `finish()`'s integrity
 * guard before `completeUpload`. A file only appears in the drive (and reopens)
 * if every one of those steps succeeded — so the assertions below transitively
 * verify the streaming wire format and the chunk index/nonce alignment.
 *
 * PREREQUISITES (this test is NOT runnable without them — see playwright.config.ts):
 *   1. docker compose -f ../../docker-compose.yml up -d postgres
 *   2. cd ../server && cargo run -p beebeeb-api      # API on :3001
 *   3. bun dev                                       # web on :5173
 *   4. bunx playwright test e2e/upload-chunk-stream.spec.ts
 *
 * For the >64 MiB single-file case, the API must be on the 256 MiB chunk-body
 * branch (feat/chunk-body-limit-256). The default file here is small enough to
 * run against the current server while still going through the new path.
 *
 * STATUS AT COMMIT: authored but NOT executed (dev API was down). Run it
 * against a live stack and fix any selector drift before trusting it.
 */

// A file large enough to span more than one web-profile chunk so the loop
// pushes several frames in order (exercises index/nonce/count alignment).
const FILE_BYTES = 18 * 1024 * 1024 // 18 MiB

test.describe('Chunk-stream upload', () => {
  let tmpFile: string

  test.beforeAll(() => {
    tmpFile = path.join(os.tmpdir(), `bb-chunk-stream-${Date.now()}.bin`)
    // Deterministic, incompressible-ish content so a future download check can
    // assert byte-identity if extended.
    const buf = Buffer.alloc(FILE_BYTES)
    for (let i = 0; i < buf.length; i += 4096) buf[i] = (i / 4096) & 0xff
    fs.writeFileSync(tmpFile, buf)
  })

  test.afterAll(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  test('multi-chunk file uploads and appears in the drive', async ({ page }) => {
    await page.goto('/')

    // If the vault is locked (no dev auto-auth), there's nothing to verify.
    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active')
    }

    // Use heading role to avoid strict-mode violation: both the sidebar nav item
    // and the breadcrumb heading contain "All files" — the heading is unique.
    await expect(page.getByRole('heading', { name: 'All files', exact: true }).or(
      page.locator('#main-content, main, [role="main"]').getByText('All files').first()
    )).toBeVisible({ timeout: 10_000 })

    // Drive renders a hidden <input type="file"> via useBrowseFiles. Setting
    // files on it triggers the same handler the "Upload" button click path uses.
    await page.locator('input[type="file"]').first().setInputFiles(tmpFile)

    const baseName = path.basename(tmpFile)

    // The file appears only after encrypt → pushChunk(s) → finish() → complete.
    await expect(page.getByText(baseName)).toBeVisible({ timeout: 60_000 })

    // The integrity guard surfaces failures as an upload-error toast; assert
    // none appeared.
    await expect(page.getByText(/upload failed/i)).toHaveCount(0)
  })
})
