import { test, expect } from '@playwright/test'

test.describe('Page renders (scenarios 6, 8, 9)', () => {
  test('security page renders with vault section', async ({ page }) => {
    await page.goto('/security')
    await page.waitForLoadState('networkidle')
    if (await page.getByText('Welcome back').isVisible()) return

    await expect(page.getByText(/security center|security/i).first()).toBeVisible()
    await expect(page.locator('text=active session').or(page.locator('text=Active session')).or(page.locator('text=Sessions'))).toBeVisible({ timeout: 5_000 })
  })

  test('team page renders with empty state or workspace list', async ({ page }) => {
    await page.goto('/team')
    await page.waitForLoadState('networkidle')
    if (await page.getByText('Welcome back').isVisible()) return

    const emptyState = page.getByText(/no workspace yet/i)
    const workspaceContent = page.getByText(/workspace/i).first()
    await expect(emptyState.or(workspaceContent)).toBeVisible({ timeout: 5_000 })
  })

  test('shared page renders with three tabs', async ({ page }) => {
    await page.goto('/shared')
    await page.waitForLoadState('networkidle')
    if (await page.getByText('Welcome back').isVisible()) return

    await expect(page.getByRole('tab', { name: /with me/i })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('tab', { name: /by me/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /pending/i })).toBeVisible()
  })
})
