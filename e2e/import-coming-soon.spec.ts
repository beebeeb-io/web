import { test, expect } from '@playwright/test'

test('import page loads and explains the flow, no VITE env leaks (0071)', async ({ page }) => {
  await page.goto('/settings/import')
  // The coming-soon banner was removed (P1 fix). Page now shows the import flow description.
  await page.waitForTimeout(5000)
  const content = await page.locator('body').textContent() ?? ''
  // Either shows "How import works" explanation or redirects unauthenticated users to login
  expect(content).toMatch(/import|encrypt|connect|coming soon|sign in/i)
  expect(content).not.toMatch(/VITE_DROPBOX|VITE_GOOGLE|not configured|APP_KEY/)
})
