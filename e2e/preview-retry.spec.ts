import { test, expect } from '@playwright/test'
import fs from 'fs'
import { writeText, uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'

/**
 * Preview transient-failure recovery (task 0691).
 *
 * A genuine transient network blip makes the preview's content fetch reject with
 * a TypeError "Failed to fetch". Previously that dead-ended on the error card
 * with no recovery; now loadAndDecrypt is wrapped in a bounded retry, so the
 * preview recovers when the next attempt succeeds.
 *
 * This drives the full-download path (a text file) and ABORTS the first
 * `/download` request (simulating the blip), then lets the retry through. The
 * preview must render the content instead of staying on the error card.
 *
 * Requires the live native stack (see playwright.config.ts / global.setup.ts) —
 * run via `make web-e2e` (isolated :3003 backend).
 */
test.describe('Preview transient-failure recovery (0691)', () => {
  let txt: string

  test.beforeAll(() => { txt = writeText(`bb-0691-${process.pid}.txt`, 'recover-me-0691\n') })
  test.afterAll(() => { try { fs.unlinkSync(txt) } catch { /* ignore */ } })

  test('retries and recovers when the first content fetch fails transiently', async ({ page }) => {
    await page.goto('/')
    const base = await uploadAndWait(page, txt)

    let downloads = 0
    let abortedFirst = false
    await page.route('**/api/v1/files/*/download', async (route) => {
      downloads++
      if (!abortedFirst) {
        abortedFirst = true
        return route.abort('failed') // transient blip on the first attempt
      }
      return route.continue()
    })

    await openPreview(page, base)

    // Recovered: the "Decrypting…" spinner clears (a blob rendered) and the
    // error card never sticks — i.e. the retry succeeded.
    await expect(previewOverlay(page).getByText('Decrypting...')).toBeHidden({ timeout: 15_000 })
    await expect(previewOverlay(page)).not.toContainText('Failed to fetch')

    expect(abortedFirst, 'the first /download should have been aborted (transient blip)').toBe(true)
    expect(downloads, 'the preview should retry the download after the transient failure').toBeGreaterThanOrEqual(2)
  })
})
