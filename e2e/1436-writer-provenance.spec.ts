import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Writer-provenance headers E2E (task 1436, the desktop/web half of 1392).
 *
 * Proves in a REAL browser (not just a bun-test mock) that a genuine upload
 * from the web app sends `X-Beebeeb-Client: web` and a non-empty
 * `X-Beebeeb-Client-Version` on the `/api/v1/uploads/init` request — the
 * exact request whose headers the server records onto the new
 * `object_versions` row (server PR #23 / task 1369, `uploads.rs`).
 *
 * PREREQUISITES: same as e2e/upload-chunk-stream.spec.ts — dev Postgres on
 * :5434, `beebeeb-api` on :3001, `bun dev` on :5173.
 */
test.describe('Writer-provenance headers', () => {
  let tmpFile: string

  test.beforeAll(() => {
    tmpFile = path.join(os.tmpdir(), `bb-1436-provenance-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'writer-provenance header check (task 1436)\n')
  })

  test.afterAll(() => {
    try {
      fs.unlinkSync(tmpFile)
    } catch {
      /* ignore */
    }
  })

  test('an upload from the drive sends both provenance headers on uploads/init', async ({ page }) => {
    await page.goto('/')

    if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
      test.skip(true, 'Vault locked — dev auto-auth not active')
    }

    await expect(
      page
        .getByRole('heading', { name: 'All files', exact: true })
        .or(page.locator('#main-content, main, [role="main"]').getByText('All files').first()),
    ).toBeVisible({ timeout: 10_000 })

    const initRequestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/v1/uploads/init') && req.method() === 'POST',
      { timeout: 15_000 },
    )

    await page.locator('input[type="file"]').first().setInputFiles(tmpFile)

    const initRequest = await initRequestPromise
    const headers = initRequest.headers()

    const baseName = path.basename(tmpFile)
    await expect(page.getByText(baseName)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/upload failed/i)).toHaveCount(0)

    expect(headers['x-beebeeb-client']).toBe('web')
    expect(headers['x-beebeeb-client-version']).toBeTruthy()
    expect(headers['x-beebeeb-client-version']).not.toBe('')
  })
})
