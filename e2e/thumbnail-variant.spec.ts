import { test, expect } from '@playwright/test'
import fs from 'fs'
import { writePng, uploadAndWait, openImagePreview, escapeRe } from './helpers/thumb-fixtures'

/**
 * Large-thumbnail gate E2E (task 0685).
 *
 * The preview only requests `GET /files/:id/thumbnail/large` when the file
 * actually has a large variant (`has_large_thumbnail === true`), eliminating
 * the guaranteed 404 for mobile/CLI/legacy uploads that only have a medium
 * thumbnail. The drive's authoritative file data comes from `listFiles`
 * (`GET /api/v1/files`), which carries the flag — so the negative case is
 * exercised by route-patching that response to `has_large_thumbnail: false`.
 *
 * Requires the live native stack (see playwright.config.ts / global.setup.ts).
 */

const LARGE_GET_RE = /\/api\/v1\/files\/[^/]+\/thumbnail\/large/
const MEDIUM_GET_RE = /\/api\/v1\/files\/[^/]+\/thumbnail(\?|$)/

test.describe('Large-thumbnail gate (0685)', () => {
  let png: string

  test.beforeAll(() => { png = writePng(`bb-0685-${process.pid}.png`, 256) })
  test.afterAll(() => { try { fs.unlinkSync(png) } catch { /* ignore */ } })

  test('image WITH a large variant requests /thumbnail/large (no 404)', async ({ page }) => {
    await page.goto('/')
    const base = await uploadAndWait(page, png)

    const largeGet: number[] = []
    page.on('response', (res) => {
      if (res.request().method() === 'GET' && LARGE_GET_RE.test(res.url())) largeGet.push(res.status())
    })

    await openImagePreview(page, base)

    // Poll, don't sample: openImagePreview returns as soon as ANY blob <img>
    // is visible in the preview, which can be milliseconds before the
    // thumbnail-first loader's GET /thumbnail/large has even been answered
    // (e2e classification 2026-09-26: trace showed the <img> 6 ms after the
    // overlay mounted and the assertion ran 6 ms later, with the large GET
    // still in flight — a spec race, not a product 404/regression).
    await expect
      .poll(() => largeGet.length, {
        message: 'a file with a large variant should request /thumbnail/large',
        timeout: 15_000,
      })
      .toBeGreaterThan(0)
    expect(largeGet.every((s) => s !== 404), `/thumbnail/large should not 404, saw ${largeGet}`).toBe(true)
  })

  test('large variant still requested when the sync snapshot lands AFTER listFiles', async ({ page }) => {
    // Deterministic form of the race found classifying this spec red on main
    // (2026-09-26): GET /sync/snapshot omits has_large_thumbnail, and when it
    // landed after GET /files the drive replaced the list with sync nodes,
    // dropping the flag — the preview then skipped /thumbnail/large and showed
    // the medium list thumbnail. Hold the snapshot back so it always lands last.
    test.setTimeout(60_000)
    await page.goto('/')
    const base = await uploadAndWait(page, png)

    await page.route('**/api/v1/sync/snapshot', async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    const listed = page.waitForResponse(
      (r) => /\/api\/v1\/files(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.ok(),
      { timeout: 20_000 },
    )
    const snapshotted = page.waitForResponse((r) => r.url().includes('/api/v1/sync/snapshot'), { timeout: 20_000 })
    await page.reload()
    await listed
    await snapshotted
    await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().waitFor({ timeout: 20_000 })

    const largeGet: number[] = []
    page.on('response', (res) => {
      if (res.request().method() === 'GET' && LARGE_GET_RE.test(res.url())) largeGet.push(res.status())
    })
    await openImagePreview(page, base)
    await expect
      .poll(() => largeGet.length, {
        message: 'a late sync snapshot must not hide the large variant from the preview',
        timeout: 15_000,
      })
      .toBeGreaterThan(0)
    expect(largeGet.every((s) => s !== 404), `/thumbnail/large should not 404, saw ${largeGet}`).toBe(true)
  })

  test('medium-only image (flag false) makes NO /thumbnail/large request', async ({ page }) => {
    // Force the authoritative listFiles response to look medium-only, mimicking
    // a mobile/CLI/legacy upload that never produced a large variant.
    await page.route('**/api/v1/files**', async (route) => {
      // Only rewrite the list endpoint (GET /api/v1/files[?...]) — leave the
      // thumbnail/content/upload sub-paths untouched (don't re-fetch binaries).
      const { pathname } = new URL(route.request().url())
      if (pathname !== '/api/v1/files') return route.continue()
      const res = await route.fetch()
      let body: unknown
      try { body = await res.json() } catch { return route.fulfill({ response: res }) }
      const clear = (f: Record<string, unknown>) => { f.has_large_thumbnail = false; return f }
      if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>
        if (Array.isArray(obj.files)) obj.files = (obj.files as Record<string, unknown>[]).map(clear)
        else if ('has_large_thumbnail' in obj) clear(obj)
      }
      return route.fulfill({ response: res, json: body })
    })

    let largeGet = false
    let mediumGet = false
    page.on('request', (req) => {
      if (req.method() !== 'GET') return
      if (LARGE_GET_RE.test(req.url())) largeGet = true
      else if (MEDIUM_GET_RE.test(req.url())) mediumGet = true
    })

    await page.goto('/')
    const base = await uploadAndWait(page, png)
    await openImagePreview(page, base)
    // Preview rendered (false-pass guard) then settle any thumbnail fetch.
    await page.waitForTimeout(1500)

    expect(largeGet, 'gate failed: /thumbnail/large requested for a medium-only file').toBe(false)
    expect(mediumGet, 'medium fallback should be used').toBe(true)
  })
})
