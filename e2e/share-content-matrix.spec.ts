import { test, expect } from '@playwright/test'
import fs from 'fs'
import { uploadTextFile, createShareLink } from './helpers/drive'

/**
 * Task 0709 — content-verifying share matrix (the proof the bug class is dead).
 *
 * Unlike the old share.spec.ts (which only checked the filename rendered + a
 * Download button existed), this drives the FULL round-trip and asserts the
 * decrypted CONTENT bytes match the original — exercising resolveFileKeyOutcome()'s
 * happy path (legacy + double-encrypted unwrap + 32-byte assertion) end-to-end.
 *
 * Owner = the auto-logged-in dev account; recipient = a fresh anonymous context.
 */
test('happy path: recipient downloads & decrypts identical content', async ({ page, browser }) => {
  test.setTimeout(120_000)

  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const content = `0709 content matrix :: the quick brown fox :: +/= edge :: ${Date.now()}`
  const filename = `cm-${Date.now()}.txt`
  await uploadTextFile(page, filename, content)

  const shareUrl = await createShareLink(page, filename)
  expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]+#key=/)

  const ctx = await browser.newContext()
  const recipient = await ctx.newPage()
  await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))

  try {
    await recipient.goto(shareUrl)

    // Filename decrypts ⇒ resolveFileKeyOutcome() resolved the key (no damaged/
    // wrong-key error). This is the happy path the held share-view commit needs.
    await expect(recipient.getByText(filename, { exact: false })).toBeVisible({ timeout: 30_000 })

    const downloadBtn = recipient.getByRole('button', { name: /download and decrypt/i })
    await expect(downloadBtn).toBeVisible({ timeout: 10_000 })

    const [download] = await Promise.all([
      recipient.waitForEvent('download', { timeout: 30_000 }),
      downloadBtn.click(),
    ])
    const path = await download.path()
    expect(path, 'download path').toBeTruthy()
    expect(fs.readFileSync(path!, 'utf8')).toBe(content)
  } finally {
    await ctx.close()
  }
})
