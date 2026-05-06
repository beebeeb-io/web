import { test, expect } from '@playwright/test'

test('data residency page loads without crash (0061)', async ({ page }) => {
  await page.goto('/settings/data-residency')
  // Page title (h1/h2, not the nav link)
  await expect(page.locator('h1, h2').getByText('Data Residency')).toBeVisible({ timeout: 15000 })
  const content = await page.locator('body').textContent() ?? ''
  expect(content).not.toMatch(/ErrorBoundary|Uncaught error|TypeError/)
})
