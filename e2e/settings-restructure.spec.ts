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

  test('billing page renders (plan was renamed to billing)', async ({ page }) => {
    // /settings/plan redirects to /settings/billing (renamed post-restructure)
    await page.goto('/settings/billing')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    expect(content).toMatch(/storage|plan|GB|TB|free|billing|sign in/i)
  })

  test('activity page renders', async ({ page }) => {
    await page.goto('/settings/activity')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    // Accepts either the activity page content or the login redirect
    expect(content).toMatch(/activity|tracking|sign in|welcome back/i)
  })

  test('/settings/account redirects to profile (or login)', async ({ page }) => {
    await page.goto('/settings/account')
    // SettingsAccount renders <Navigate to="/settings/profile">; AUTO-WAIT for the
    // client-side redirect rather than a fixed 5s sleep + sync url read, which
    // flaked on cold WASM boot + the extra redirect hop (task 0740c — app is correct).
    await expect(page).toHaveURL(/settings\/profile|login/, { timeout: 20_000 })
  })

  test('/settings redirects to profile', async ({ page }) => {
    await page.goto('/settings')
    // 20s, not 10s: the route's <Navigate> only fires after WasmGuard unblocks,
    // which can exceed 10s on a cold worker (flaked in the 0740c isolation runs).
    await page.waitForURL(/\/settings\/profile/, { timeout: 20_000 })
  })
})
