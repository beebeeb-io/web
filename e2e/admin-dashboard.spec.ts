import { test, expect } from '@playwright/test'
import { envTestAccount, loginAndProvision } from './helpers/auth'

/**
 * E2E coverage for the admin dashboard's growth chart — specifically the
 * fix from task 0021, which renamed the misleading "Storage" tab and added
 * per-metric units to tooltips and the y-axis tick.
 *
 * Prerequisites (manual): full local stack + BB_TEST_USER_* env pointing at
 * an account that has the admin role in the DB. This test `test.skip`s
 * cleanly if either is missing — same convention as the OPAQUE test in
 * auth.spec.ts.
 */
test.describe('Admin dashboard — growth chart (regression: task 0021)', () => {
  test('storage tab shows bytes-with-unit, not a bare number', async ({ page }) => {
    const account = envTestAccount()
    test.skip(!account, 'Set BB_TEST_USER_* env vars (and ensure the account is admin) to run this test')

    await loginAndProvision(page, account!)

    // Drive page reached. Navigate to /admin.
    await page.goto('/admin')

    // Skip if this account isn't admin — the route gate kicks back to /login
    // or the dashboard renders an unauthorized message. We don't want to fail
    // the test on a bad account, just skip cleanly.
    await page.waitForLoadState('networkidle')
    if (!page.url().includes('/admin')) {
      test.skip(true, 'Configured BB_TEST_USER is not admin — cannot reach /admin')
    }

    // Tab labels — pre-fix these said "Signups / Storage / Shares" with no
    // hint about what was being plotted. Post-fix they describe the metric.
    await expect(page.getByRole('button', { name: /^new users$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^storage growth$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^new shares$/i })).toBeVisible()

    // Switch to Storage growth and verify the y-axis tick + tooltip carry
    // byte units (B/KB/MB/GB/TB), not a bare integer.
    await page.getByRole('button', { name: /^storage growth$/i }).click()

    // Y-axis tick rendered top-left of the plot — must be in byte format.
    // Could be "0 B" if the test DB has no uploads in window — both pass.
    const axisLabel = page.locator('div').filter({
      hasText: /^\d+(\.\d+)?\s*(B|KB|MB|GB|TB)$/,
    }).first()
    await expect(axisLabel).toBeVisible()

    // Hover the last bar (today) to make the tooltip appear, then assert on
    // its text. The tooltip is hidden by default and revealed on group-hover
    // of its parent bar container.
    const bars = page.locator('[data-testid="growth-chart-tooltip"]')
    const lastBar = bars.last()
    await lastBar.locator('..').hover()
    const tooltipText = await lastBar.textContent()

    // Either "X.Y GB added" / "X MB added" / "0 B added" — bytes + " added".
    // Or, if no data yet, the empty-state overlay appears instead — match either.
    const emptyState = await page.getByTestId('growth-chart-empty').isVisible().catch(() => false)
    if (!emptyState) {
      expect(
        tooltipText ?? '',
        `tooltip should carry byte unit, got: ${tooltipText}`,
      ).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB|TB)\s+added/)
    }

    // And it must not be the buggy bare-integer format from before.
    expect(tooltipText ?? '').not.toMatch(/:\s*\d+$/)
  })

  test('signups tab tooltips say "new users", shares tab says "shares"', async ({ page }) => {
    const account = envTestAccount()
    test.skip(!account, 'Set BB_TEST_USER_* env vars to run this test')

    await loginAndProvision(page, account!)
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    if (!page.url().includes('/admin')) {
      test.skip(true, 'Configured BB_TEST_USER is not admin')
    }

    // Signups tab
    await page.getByRole('button', { name: /^new users$/i }).click()
    {
      const lastBar = page.locator('[data-testid="growth-chart-tooltip"]').last()
      await lastBar.locator('..').hover()
      const text = (await lastBar.textContent()) ?? ''
      const isEmpty = await page.getByTestId('growth-chart-empty').isVisible().catch(() => false)
      if (!isEmpty) expect(text).toMatch(/new users?/i)
    }

    // Shares tab
    await page.getByRole('button', { name: /^new shares$/i }).click()
    {
      const lastBar = page.locator('[data-testid="growth-chart-tooltip"]').last()
      await lastBar.locator('..').hover()
      const text = (await lastBar.textContent()) ?? ''
      const isEmpty = await page.getByTestId('growth-chart-empty').isVisible().catch(() => false)
      if (!isEmpty) expect(text).toMatch(/shares? created/i)
    }
  })
})
