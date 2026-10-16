import { test, expect } from '@playwright/test'

test.describe.configure({ retries: 0 })

test('1909: five selected files admit two uploads and queued cancellation never reaches init', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main').getByRole('button', { name: 'Upload files', exact: true })).toBeVisible()
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  let hold = true, initCalls = 0
  await page.route(/\/api\/v1\/(uploads\/init|files\/upload\/init)$/, async route => {
    initCalls++
    if (hold) await gate
    await route.continue()
  })
  const files = Array.from({ length: 5 }, (_, i) => ({
    name: `admission-1909-${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`file ${i}`),
  }))
  try {
    await page.locator('input[type="file"]').first().setInputFiles(files)
    await expect.poll(() => initCalls).toBe(2)
    await expect(page.getByTestId('upload-card')).toHaveCount(5)
    await page.getByTestId('upload-card').filter({ hasText: files[3].name })
      .getByRole('button', { name: 'Cancel upload', exact: true }).click()
    await expect(page.getByTestId('upload-card')).toHaveCount(4)
    // The init requests stay held while the queue cancellation is exercised.
    expect(initCalls).toBe(2)
  } finally { hold = false; release() }
  await expect(page.getByTestId('upload-card')).toHaveCount(0, { timeout: 30_000 })
  expect(initCalls).toBe(4)
  const listing = page.getByRole('rowgroup', { name: 'Files and folders' })
  for (const i of [0, 1, 2, 4]) await expect(listing.getByText(files[i].name, { exact: true })).toBeVisible()
  await expect(listing.getByText(files[3].name, { exact: true })).toHaveCount(0)
  await expect(page.getByText(/upload failed/i)).toHaveCount(0)
})
