import { test, expect } from '@playwright/test'

test('photos tab has upload button (0073)', async ({ page }) => {
  await page.goto('/photos')
  // Wait for page to load
  await page.waitForTimeout(3000)
  // Check the page content for upload-related text
  const content = await page.locator('body').textContent() ?? ''
  expect(content).toMatch(/Upload|upload/)
  // Screenshot for visual confirmation
  await page.screenshot({ path: '../../qa-screenshots/photos-upload-test.png' })
})
