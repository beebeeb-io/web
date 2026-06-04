import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Large-thumbnail upload E2E (task 0629).
 *
 * On image upload the web client generates and uploads BOTH a medium
 * (`PUT /files/:id/thumbnail`) and a large (`PUT /files/:id/thumbnail/large`)
 * variant. Non-image uploads generate no thumbnail at all.
 *
 *   Positive (image): upload an image → both the medium and the large
 *                     thumbnail PUTs fire. File appears in the drive (guard).
 *   Negative (text):  upload a .txt → NO thumbnail PUT (medium or large).
 *                     File appears in the drive (guard).
 *
 * PREREQUISITES (NOT runnable without them — see playwright.config.ts):
 *   1. docker compose -f ../../docker-compose.yml up -d postgres
 *   2. cd ../server && cargo run -p beebeeb-api      # API on :3001
 *   3. bun dev                                       # web on :5173
 *   4. bunx playwright test e2e/thumbnail-upload.spec.ts
 *
 * STATUS AT COMMIT (2026-06-05): authored but NOT executed — docker is
 * unavailable in the build environment. Batch with 0628/0685 on a
 * docker-capable host; fix any selector drift against the live upload UI.
 */

const LARGE_PUT_RE = /\/api\/v1\/files\/[^/]+\/thumbnail\/large/
const MEDIUM_PUT_RE = /\/api\/v1\/files\/[^/]+\/thumbnail(\?|$)/

function writeTinyPng(): string {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const file = path.join(os.tmpdir(), `bb-thumb-upload-${process.pid}.png`)
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
  return file
}

function writeTinyTxt(): string {
  const file = path.join(os.tmpdir(), `bb-thumb-upload-${process.pid}.txt`)
  fs.writeFileSync(file, 'no thumbnail for plain text\n', 'utf-8')
  return file
}

test.describe('Large-thumbnail upload (0629)', () => {
  let png: string
  let txt: string

  test.beforeAll(() => {
    png = writeTinyPng()
    txt = writeTinyTxt()
  })

  test.afterAll(() => {
    for (const f of [png, txt]) { try { fs.unlinkSync(f) } catch { /* ignore */ } }
  })

  test('image upload PUTs both medium and large thumbnails', async ({ page }) => {
    let mediumPut = false
    let largePut = false
    page.on('request', (req) => {
      if (req.method() !== 'PUT') return
      if (LARGE_PUT_RE.test(req.url())) largePut = true
      else if (MEDIUM_PUT_RE.test(req.url())) mediumPut = true
    })

    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active; cannot run upload flow.')
    }

    await page.locator('input[type="file"]').first().setInputFiles(png)

    // File must land in the drive (guard) — then the best-effort thumbnail
    // PUTs should both have fired.
    await expect(page.getByText(path.basename(png), { exact: false }).first())
      .toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2000) // best-effort thumbnails run after completeUpload

    expect(mediumPut, 'expected a medium thumbnail PUT (/thumbnail)').toBe(true)
    expect(largePut, 'expected a large thumbnail PUT (/thumbnail/large)').toBe(true)
  })

  test('text upload PUTs no thumbnail', async ({ page }) => {
    let mediumPut = false
    let largePut = false
    page.on('request', (req) => {
      if (req.method() !== 'PUT') return
      if (LARGE_PUT_RE.test(req.url())) largePut = true
      else if (MEDIUM_PUT_RE.test(req.url())) mediumPut = true
    })

    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active; cannot run upload flow.')
    }

    await page.locator('input[type="file"]').first().setInputFiles(txt)

    await expect(page.getByText(path.basename(txt), { exact: false }).first())
      .toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2000)

    expect(largePut, 'text file must not PUT a large thumbnail').toBe(false)
    expect(mediumPut, 'text file must not PUT a medium thumbnail').toBe(false)
  })
})
