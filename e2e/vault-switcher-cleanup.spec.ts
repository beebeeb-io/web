import { test, expect } from '@playwright/test'

/**
 * Task 0258 — business/team vaults are deferred; the sidebar must NOT show the
 * dead `aria-disabled` "Business — Coming soon" placeholder (it violated the
 * brand bar: no placeholder UIs in prod). The vault pill is now a static,
 * non-interactive identity label — not a switcher-to-nothing.
 *
 * Runs under the authenticated project (dev account → "Dev's vault").
 */
test('sidebar vault pill is a static label — no dropdown, no "Coming soon" placeholder (0258)', async ({ page }) => {
  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // The vault identity is shown…
  await expect(page.getByText(/vault$/i).first()).toBeVisible({ timeout: 15_000 })

  // …but the dead team-vault placeholder is gone entirely.
  await expect(page.getByText('Coming soon')).toHaveCount(0)
  await expect(page.getByText('Business', { exact: true })).toHaveCount(0)

  // And it is no longer a switcher: the old control was a <button> whose
  // accessible name was the vault name. The static pill is a <div>, so there
  // must be no button named after the vault. (The UserCard menu button, named
  // after the user, is unaffected.)
  await expect(page.getByRole('button', { name: /vault/i })).toHaveCount(0)

  await page.locator('aside').first().screenshot({ path: 'test-results/0258-vault-pill-static.png' })
})
