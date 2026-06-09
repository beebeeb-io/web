import { test, expect, type Page } from '@playwright/test'

/**
 * Task 0709 — share-view error truth. resolveFileKeyOutcome() discriminates the
 * key-resolution failures that used to collapse into one generic "Decryption
 * failed", and NEVER silently uses K_c as the file key. These specs mock the
 * public getShare response (GET /api/v1/shares/:token) so we can assert each
 * distinct, honest error card without needing real crypto material.
 */

// 32 zero bytes, base64 — a well-formed (but for these tests, never-unwrapped) key.
const KEY32_B64 = Buffer.from(new Uint8Array(32)).toString('base64')

/** Intercept getShare for `token` and return a crafted ShareView. */
async function mockShare(page: Page, token: string, body: Record<string, unknown>) {
  await page.route(`**/api/v1/shares/${token}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'share-' + token,
        name_encrypted: '{"nonce":"AAAA","ciphertext":"BBBB"}',
        size_bytes: 1234,
        ...body,
      }),
    }),
  )
}

test.describe('share-view error truth (0709)', () => {
  test('double_encrypted share missing wrapped_file_key → "damaged", not silent wrong-key', async ({ page }) => {
    const token = 'DAMAGED1'
    // Inconsistent metadata: flag set, but no wrapped_file_key. Pre-fix this
    // silently used K_c as the file key → generic "Decryption failed".
    await mockShare(page, token, { double_encrypted: true })

    await page.goto(`/s/${token}#key=${encodeURIComponent(KEY32_B64)}`)

    await expect(page.getByText('This share link is damaged')).toBeVisible({ timeout: 15_000 })
    // It must NOT offer to "Download and decrypt" a broken share.
    await expect(page.getByRole('button', { name: /download and decrypt/i })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/0709-share-view-damaged.png', fullPage: false })
  })

  test('truncated #key= fragment → "this link is incomplete"', async ({ page }) => {
    const token = 'TRUNC1'
    await mockShare(page, token, { double_encrypted: false })

    // 3-byte key ("abc") — not the required 32 bytes.
    await page.goto(`/s/${token}#key=${encodeURIComponent('YWJj')}`)

    await expect(page.getByText('This link is incomplete')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /download and decrypt/i })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/0709-share-view-truncated.png', fullPage: false })
  })
})
