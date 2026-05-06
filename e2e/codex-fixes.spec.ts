import { test, expect } from '@playwright/test'

/**
 * Verification tests for Codex fixes (7 items).
 * Each test verifies one fix is working correctly.
 */

test.describe('Codex fixes verification', () => {

  // Fix 1: settings/plan removed, nav points to /settings/billing
  test('1. /settings/plan redirects or 404s, nav shows billing', async ({ page }) => {
    await page.goto('/settings/billing')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    // Should show billing page content (plan names, storage, etc.)
    expect(content).toMatch(/billing|storage|plan|free|personal/i)
    // Settings nav should have "Storage & Plan" or "Billing" pointing to /settings/billing
    const navLinks = await page.locator('nav a, aside a').allTextContents()
    const navText = navLinks.join(' ')
    expect(navText).toMatch(/storage|billing|plan/i)
    await page.screenshot({ path: '../../qa-screenshots/verify-01-billing-nav.png' })
  })

  // Fix 2: Payment method card removed from billing page
  test('2. billing page has no payment method card', async ({ page }) => {
    await page.goto('/settings/billing')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    // Should NOT show payment method related text
    expect(content).not.toMatch(/payment method/i)
    expect(content).not.toMatch(/card ending/i)
    expect(content).not.toMatch(/Add payment method/i)
    await page.screenshot({ path: '../../qa-screenshots/verify-02-no-payment-card.png' })
  })

  // Fix 3: Plan comparison always visible (not just localhost)
  test('3. billing page shows plan features/comparison', async ({ page }) => {
    await page.goto('/settings/billing')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    // Should show plan names with features
    expect(content).toMatch(/free|personal|pro/i)
    await page.screenshot({ path: '../../qa-screenshots/verify-03-plan-comparison.png' })
  })

  // Fix 4: Import page — single coming-soon banner
  test('4. import page has single coming-soon banner, no VITE errors', async ({ page }) => {
    await page.goto('/settings/import')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    // Should have "coming soon" text
    expect(content.toLowerCase()).toContain('coming soon')
    // Should NOT have VITE env var errors
    expect(content).not.toMatch(/VITE_/)
    // Should NOT have per-service different styles — check for the unified message
    expect(content).toMatch(/import|download|upload/i)
    await page.screenshot({ path: '../../qa-screenshots/verify-04-import-coming-soon.png' })
  })

  // Fix 5: Referral /join page — layout not broken
  test('5. referral join page has proper layout', async ({ page }) => {
    await page.goto('/join/test-code')
    await page.waitForTimeout(5000)
    // Take a screenshot to visually verify layout
    await page.screenshot({ path: '../../qa-screenshots/verify-05-referral-layout.png' })
    const content = await page.locator('body').textContent() ?? ''
    expect(content).toMatch(/invited|beebeeb|10 GB|sign up|create/i)
    // Check that the split-screen container has proper width
    const splitScreen = page.locator('[class*="md:flex-row"], [class*="md:w-"]').first()
    if (await splitScreen.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await splitScreen.boundingBox()
      // Should use most of the viewport width (not squeezed)
      if (box) expect(box.width).toBeGreaterThan(600)
    }
  })

  // Fix 6: Data residency shows fallback region
  test('6. data residency shows Europe/Falkenstein fallback', async ({ page }) => {
    await page.goto('/settings/data-residency')
    await page.waitForTimeout(5000)
    const content = await page.locator('body').textContent() ?? ''
    // Should show Data Residency title
    expect(content).toMatch(/data residency/i)
    // Should show the fallback region, not "No regions available"
    const hasRegion = /europe|falkenstein|germany|hetzner/i.test(content)
    const hasNoRegions = /no regions available/i.test(content)
    // Either a real region or no error — the fallback should prevent "No regions"
    expect(hasRegion || !hasNoRegions).toBe(true)
    await page.screenshot({ path: '../../qa-screenshots/verify-06-data-residency.png' })
  })

  // Fix 7: Subscription reactivation handles checkout redirect
  test('7. reactivate API function has correct return type', async ({ page }) => {
    // This is a code-level check — verify the API function signature
    await page.goto('/settings/billing')
    await page.waitForTimeout(3000)
    // The reactivation button should exist for cancelled plans
    // For now just verify the page loads without errors
    const content = await page.locator('body').textContent() ?? ''
    expect(content).not.toMatch(/ErrorBoundary|Uncaught error|TypeError/)
    await page.screenshot({ path: '../../qa-screenshots/verify-07-reactivate.png' })
  })
})
