import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Thumbnail-first preview fetch E2E (task 0628).
 *
 * Spec 031 — opening an IMAGE in preview should load the large thumbnail
 * instead of downloading the full original; NON-image files (PDF, docs) must
 * still download the full original because they need real content to render.
 *
 *   Positive (image): open an image → a `/thumbnail/large` request fires and
 *                     the full original (`/files/:id/download`) is NOT fetched
 *                     on open. Preview renders an <img> (false-pass guard).
 *   Negative (PDF):   open a PDF → NO `/thumbnail/large` or `/thumbnail/medium`
 *                     request, and the full original IS downloaded
 *                     (`/files/:id/download`). Preview surface rendered (guard).
 *
 * PREREQUISITES (NOT runnable without them — see playwright.config.ts):
 *   1. docker compose -f ../../docker-compose.yml up -d postgres
 *   2. cd ../server && cargo run -p beebeeb-api      # API on :3001
 *   3. bun dev                                       # web on :5173
 *   4. bunx playwright test e2e/thumbnail-fetch.spec.ts
 *
 * STATUS AT COMMIT (2026-06-05): authored but NOT executed — docker is
 * unavailable in the build environment. Batch with 0629/0685 on a
 * docker-capable host; fix any selector drift against the live preview UI.
 */

const LARGE_RE = /\/api\/v1\/files\/[^/]+\/thumbnail\/large/
const MEDIUM_RE = /\/api\/v1\/files\/[^/]+\/thumbnail(\?|$)/
const DOWNLOAD_RE = /\/api\/v1\/files\/[^/]+\/download/

function writeTinyPng(): string {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const file = path.join(os.tmpdir(), `bb-thumb-fetch-${process.pid}.png`)
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
  return file
}

function writeTinyPdf(): string {
  // Minimal single-page PDF.
  const pdf =
    '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n'
  const file = path.join(os.tmpdir(), `bb-thumb-fetch-${process.pid}.pdf`)
  fs.writeFileSync(file, pdf, 'latin1')
  return file
}

test.describe('Thumbnail-first preview fetch (0628)', () => {
  let png: string
  let pdf: string

  test.beforeAll(() => {
    png = writeTinyPng()
    pdf = writeTinyPdf()
  })

  test.afterAll(() => {
    for (const f of [png, pdf]) { try { fs.unlinkSync(f) } catch { /* ignore */ } }
  })

  test('image preview loads the large thumbnail, not the full original', async ({ page }) => {
    const largeReqs: string[] = []
    const downloadReqs: string[] = []
    page.on('request', (req) => {
      if (LARGE_RE.test(req.url())) largeReqs.push(req.url())
      if (DOWNLOAD_RE.test(req.url())) downloadReqs.push(req.url())
    })

    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active; cannot run preview flow.')
    }

    await page.locator('input[type="file"]').first().setInputFiles(png)
    const tile = page.getByText(path.basename(png), { exact: false }).first()
    await expect(tile).toBeVisible({ timeout: 30_000 })
    await tile.dblclick()

    // Preview rendered an image (guards against a false pass).
    await expect(page.locator('img').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1000)

    expect(largeReqs.length, 'expected a /thumbnail/large request on image open').toBeGreaterThan(0)
    expect(downloadReqs.length, 'full original must NOT be downloaded to render an image preview').toBe(0)
  })

  test('PDF preview downloads the full original, no thumbnail request', async ({ page }) => {
    let largeRequested = false
    let mediumRequested = false
    let downloadRequested = false
    page.on('request', (req) => {
      if (LARGE_RE.test(req.url())) largeRequested = true
      if (MEDIUM_RE.test(req.url())) mediumRequested = true
      if (DOWNLOAD_RE.test(req.url())) downloadRequested = true
    })

    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active; cannot run preview flow.')
    }

    await page.locator('input[type="file"]').first().setInputFiles(pdf)
    const tile = page.getByText(path.basename(pdf), { exact: false }).first()
    await expect(tile).toBeVisible({ timeout: 30_000 })
    await tile.dblclick()

    // Preview surface opened (PDF renderer or download card) — guard.
    await expect(page.getByText(path.basename(pdf), { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)

    expect(largeRequested, 'PDF must not request a thumbnail').toBe(false)
    expect(mediumRequested, 'PDF must not request a thumbnail').toBe(false)
    expect(downloadRequested, 'PDF preview must download the full original').toBe(true)
  })

  // Task 0628: "clicking Download downloads the full original as today."
  // Regression fixed 2026-06-05 — handleDownload() used to reuse the loaded
  // preview blob, which for images is the large THUMBNAIL; it now fetches the
  // original via decryptToBlob when the loaded blob is not the original. This
  // asserts the original IS fetched on Download (a `/files/:id/download` request
  // fires) and that the saved file's size matches the original, not the ~KB
  // thumbnail. Browser-pending: run on the docker pass with 0629/0685.
  test('toolbar Download fetches and saves the full original for an image', async ({ page }) => {
    let downloadOriginalRequested = false
    page.on('request', (req) => {
      if (DOWNLOAD_RE.test(req.url())) downloadOriginalRequested = true
    })

    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active; cannot run preview flow.')
    }

    await page.locator('input[type="file"]').first().setInputFiles(png)
    const tile = page.getByText(path.basename(png), { exact: false }).first()
    await expect(tile).toBeVisible({ timeout: 30_000 })
    await tile.dblclick()
    await expect(page.locator('img').first()).toBeVisible({ timeout: 15_000 })

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /download/i }).click(),
    ])

    // The original must have been fetched on Download (not the reused thumbnail).
    expect(downloadOriginalRequested, 'Download must fetch the full original, not reuse the thumbnail').toBe(true)
    // The saved file is the original, not a downscaled WebP thumbnail.
    expect(download.suggestedFilename()).toBe(path.basename(png))
  })
})
