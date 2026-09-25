import { test, expect, type Page } from '@playwright/test'

/**
 * Flow-4 money-flow finding 4 — a trialing user's "Switch to annual" must work.
 *
 * Real stack (e2e/scripts/web-e2e.sh: isolated API + fresh DB, dev auto-login
 * user on the Free plan). Before the fix, `POST /billing/switch-cycle` only
 * looked at `status = 'active'` rows, so a trialing user who clicked the
 * "Save on your plan → Switch to annual" banner got a 404 and a
 * "Failed to switch billing cycle" toast — and `/trial/convert` then charged
 * them MONTHLY at trial end. RED against server main; GREEN with the server
 * fix (trial row re-pinned locally, no provider call).
 *
 * Run: E2E_API_PORT=… E2E_VITE_PORT=… bash e2e/scripts/web-e2e.sh e2e/flow4-trial-switch-annual.spec.ts
 */

async function waitForCryptoReady(page: Page) {
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
}

test('trialing user switches to annual: no error toast, plan card shows Yearly', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/settings/billing')
  await waitForCryptoReady(page)

  // Free user → the change view holds the trial CTA.
  await page.getByRole('button', { name: /Choose a plan/i }).click()
  await page.getByRole('button', { name: /Start 14-day Pro trial/i }).click()
  await expect(page.getByText('Your free trial has started')).toBeVisible({ timeout: 15_000 })

  // The trial is monthly (no cycle choice at trial start) → the annual
  // savings banner is offered.
  const banner = page.getByText('Save on your plan')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^Switch to annual$/ }).click()

  // Trial-honest confirm copy, not the paid "current monthly period" promise.
  await expect(page.getByTestId('cycle-switch-trial-note')).toContainText('nothing is charged today')
  await expect(page.getByText(/Your current monthly period stays active/)).toHaveCount(0)

  await page.getByRole('button', { name: /Confirm switch to annual/i }).click()

  await expect(page.getByText('Switched to annual billing')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Failed to switch billing cycle')).toHaveCount(0)

  // Card reflects the server truth after reload: Yearly chip, no savings banner.
  await expect(page.getByText('Yearly', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(banner).toHaveCount(0)
  await page.screenshot({ path: 'test-results/flow4-trial-switch-annual.png', fullPage: true })

  // And it sticks across a full reload (server row, not optimistic UI).
  await page.reload()
  await waitForCryptoReady(page)
  await page.getByRole('button', { name: /Change plan|Choose a plan/i }).first().click()
  await expect(page.getByText('Yearly', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
})
