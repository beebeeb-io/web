import { test, expect } from '@playwright/test'

test('import page shows coming soon, no VITE errors (0071)', async ({ page }) => {
  await page.goto('/settings/import')
  await expect(page.getByText('Coming soon').first()).toBeVisible({ timeout: 15000 })
  const content = await page.locator('body').textContent() ?? ''
  expect(content).not.toMatch(/VITE_DROPBOX|VITE_GOOGLE|not configured|APP_KEY/)
})
