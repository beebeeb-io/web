import { test, expect } from '@playwright/test'
import fs from 'fs'
import { writePng, writeText, uploadAndWait } from './helpers/thumb-fixtures'

/**
 * Large-thumbnail upload E2E (task 0629).
 *
 * On image upload the web client generates and uploads BOTH a medium
 * (`PUT /files/:id/thumbnail`) and a large (`PUT /files/:id/thumbnail/large`)
 * variant. Non-image uploads generate no thumbnail at all.
 *
 * Requires the live native stack (see playwright.config.ts / global.setup.ts):
 *   API on :3001 (debug, /dev/auto-login) + `bun dev` on :5173.
 */

const LARGE_PUT_RE = /\/api\/v1\/files\/[^/]+\/thumbnail\/large/
const MEDIUM_PUT_RE = /\/api\/v1\/files\/[^/]+\/thumbnail(\?|$)/

test.describe('Large-thumbnail upload (0629)', () => {
  let png: string
  let txt: string

  test.beforeAll(() => {
    png = writePng(`bb-0629-${process.pid}.png`, 256)
    txt = writeText(`bb-0629-${process.pid}.txt`)
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
    await uploadAndWait(page, png)
    // Thumbnails are best-effort, uploaded after completeUpload — give them a beat.
    await expect.poll(() => largePut && mediumPut, { timeout: 15_000 }).toBe(true)

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
    await uploadAndWait(page, txt)
    await page.waitForTimeout(2500)

    expect(largePut, 'text file must not PUT a large thumbnail').toBe(false)
    expect(mediumPut, 'text file must not PUT a medium thumbnail').toBe(false)
  })
})
