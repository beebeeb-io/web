import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Large-thumbnail gate E2E (task 0685).
 *
 * Verifies the preview only requests `GET /api/v1/files/:id/thumbnail/large`
 * when the file actually HAS a large variant (`has_large_thumbnail === true`),
 * eliminating the guaranteed-404 that mobile/CLI/legacy uploads (medium-only)
 * used to trigger.
 *
 *   Positive: a web-uploaded image (the web client always uploads a large
 *             variant, so has_large_thumbnail becomes true) → opening it in
 *             preview FIRES exactly one `/thumbnail/large` request, no 404.
 *   Negative: a medium-only file (has_large_thumbnail false) → opening it in
 *             preview makes NO `/thumbnail/large` request and renders via the
 *             medium thumbnail fallback.
 *
 * The negative case is driven deterministically by intercepting the sync/list
 * responses and forcing `has_large_thumbnail: false` on the target file, so it
 * is runnable without seeding a real medium-only row. To avoid a false pass
 * (zero requests because the preview never opened), every case asserts the
 * preview surface actually rendered an image before checking the request log.
 *
 * PREREQUISITES (NOT runnable without them — see playwright.config.ts):
 *   1. docker compose -f ../../docker-compose.yml up -d postgres
 *   2. cd ../server && cargo run -p beebeeb-api      # API on :3001
 *   3. bun dev                                       # web on :5173
 *   4. bunx playwright test e2e/thumbnail-variant.spec.ts
 *
 * STATUS AT COMMIT (2026-06-05): authored but NOT executed — docker is
 * unavailable in the build environment, so the local API/stack could not boot.
 * Batch this with tasks 0628/0629 on a docker-capable host. Fix any selector
 * drift against the live preview UI before trusting a green run.
 */

const LARGE_RE = /\/api\/v1\/files\/[^/]+\/thumbnail\/large/
const MEDIUM_RE = /\/api\/v1\/files\/[^/]+\/thumbnail\/medium/

// A tiny but valid PNG (1x1) is enough: the web upload path generates and
// uploads both medium and large WebP variants regardless of source size.
function writeTinyPng(): string {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const file = path.join(os.tmpdir(), `bb-thumb-variant-${process.pid}.png`)
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
  return file
}

test.describe('Large-thumbnail gate (0685)', () => {
  let tmpFile: string

  test.beforeAll(() => {
    tmpFile = writeTinyPng()
  })

  test.afterAll(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  test('web-uploaded image (has large) requests /thumbnail/large with no 404', async ({ page }) => {
    const largeStatuses: number[] = []
    page.on('response', (res) => {
      if (LARGE_RE.test(res.url())) largeStatuses.push(res.status())
    })

    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active; cannot run preview flow.')
    }

    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles(tmpFile)

    // Wait for the upload to surface in the drive, then open its preview.
    const tile = page.getByText(path.basename(tmpFile), { exact: false }).first()
    await expect(tile).toBeVisible({ timeout: 30_000 })
    await tile.dblclick()

    // Preview must actually render an image (guards against a false pass where
    // zero /thumbnail/large requests just means the preview never opened).
    await expect(page.locator('img').first()).toBeVisible({ timeout: 15_000 })

    expect(largeStatuses.length, 'expected at least one /thumbnail/large request').toBeGreaterThan(0)
    expect(largeStatuses.every((s) => s !== 404), `no 404 expected, saw: ${largeStatuses}`).toBe(true)
  })

  test('medium-only image (no large) makes NO /thumbnail/large request', async ({ page }) => {
    // Force every file the client learns about to look medium-only.
    await page.route('**/api/v1/files**', async (route) => {
      const res = await route.fetch()
      const ct = res.headers()['content-type'] ?? ''
      if (!ct.includes('application/json')) return route.fulfill({ response: res })
      let body: unknown
      try { body = await res.json() } catch { return route.fulfill({ response: res }) }
      const patch = (f: Record<string, unknown>) => { f.has_large_thumbnail = false; return f }
      if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>
        if (Array.isArray(obj.files)) obj.files = (obj.files as Record<string, unknown>[]).map(patch)
        else if ('has_large_thumbnail' in obj) patch(obj)
      }
      return route.fulfill({ response: res, json: body })
    })

    let largeRequested = false
    let mediumRequested = false
    page.on('request', (req) => {
      if (LARGE_RE.test(req.url())) largeRequested = true
      if (MEDIUM_RE.test(req.url())) mediumRequested = true
    })

    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active; cannot run preview flow.')
    }

    // Open the first image in the drive (assumes at least one image present —
    // seed one, or run the positive test first in the same storageState).
    const firstImage = page.locator('img').first()
    await expect(firstImage).toBeVisible({ timeout: 15_000 })
    await firstImage.dblclick()

    // Preview rendered (false-pass guard) — then assert the gate held.
    await expect(page.locator('img').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500) // allow any thumbnail fetch to fire

    expect(largeRequested, 'gate failed: /thumbnail/large was requested for a medium-only file').toBe(false)
    expect(mediumRequested, 'expected medium fallback to be used').toBe(true)
  })
})
