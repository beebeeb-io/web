import { test, expect } from '@playwright/test'

test.describe('Settings restructure (028)', () => {
  test('profile page renders', async ({ page }) => {
    await page.goto('/settings/profile')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    expect(content).toMatch(/profile|email|name|account/i)
  })

  test('security page renders, no test phrase button (0062)', async ({ page }) => {
    await page.goto('/settings/security')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    expect(content).toMatch(/security|recovery|password|passkey/i)
    expect(content).not.toMatch(/test recovery phrase/i)
  })

  test('plan page renders', async ({ page }) => {
    await page.goto('/settings/plan')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    expect(content).toMatch(/storage|plan|GB|TB|free/i)
  })

  test('activity page renders', async ({ page }) => {
    await page.goto('/settings/activity')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    expect(content).toMatch(/activity|tracking/i)
  })

  test('/settings/account redirects to profile', async ({ page }) => {
    await page.goto('/settings/account')
    await page.waitForURL(/\/settings\/profile/, { timeout: 10000 })
  })

  test('/settings redirects to profile', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForURL(/\/settings\/profile/, { timeout: 10000 })
  })
})
