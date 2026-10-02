import { test, expect, type Page } from '@playwright/test'

/**
 * Settings > Notifications — the in-app switches must save in the shape the
 * server stores. PUT /api/v1/notifications/preferences (beebeeb-api
 * routes/notifications.rs) deserializes flat `Option<bool>` values for
 * new_device_login / share_received / storage_warning / backup_complete (the
 * push preferences read by push_delivery::send_push) and ignores other keys.
 *
 * Before this fix the page PUT a {in_app, email} object for all 15 types, so
 * every toggle was a 422 ("new_device_login: invalid type: map, expected a
 * boolean") and the user saw "Failed to save preferences".
 *
 * Kept in its own file: web-e2e.sh isolates per file, and a third page load in
 * one worker intermittently landed on /login under load (instrument, not code).
 */

async function openNotifications(page: Page) {
  await page.goto('/settings/notifications')
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
  await expect(page.getByText('New device sign-in')).toBeVisible({ timeout: 15_000 })
}

test('in-app switch saves in the shape the server stores and survives a remount', async ({ page }) => {
  // PUT /api/v1/notifications/preferences deserializes flat booleans for the
  // push-backed keys. Before this fix the page sent {in_app, email} objects for
  // all 15 types, so every save was a 422 and showed "Failed to save preferences".
  await openNotifications(page)
  const sw = () => page.getByRole('switch', { name: /^Storage quota warning in-app/ })
  const before = await sw().getAttribute('aria-checked')
  const after = before === 'true' ? 'false' : 'true'

  const put = page.waitForResponse(
    (r) => r.url().includes('/api/v1/notifications/preferences') && r.request().method() === 'PUT',
  )
  await sw().click()
  const res = await put
  expect(res.status(), await res.text()).toBe(200)
  expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({
    new_device_login: expect.any(Boolean),
    share_received: expect.any(Boolean),
    storage_warning: after === 'true',
    backup_complete: expect.any(Boolean),
  })
  await expect(page.getByText('Failed to save preferences')).toHaveCount(0)
  await expect(sw()).toHaveAttribute('aria-checked', after)

  // Remount the page via in-app navigation so it re-reads the server's copy
  // (a hard reload can re-lock the vault under load, which tests nothing here).
  await page.locator('a[href="/settings/appearance"]:visible').first().click()
  await expect(page).toHaveURL(/\/settings\/appearance/)
  const get = page.waitForResponse(
    (r) => r.url().includes('/api/v1/notifications/preferences') && r.request().method() === 'GET',
  )
  await page.locator('a[href="/settings/notifications"]:visible').first().click()
  expect((await get).status()).toBe(200)
  await expect(sw(), 'stored value after remount').toHaveAttribute('aria-checked', after)

  // Restore so the shared dev user is left as found.
  const restore = page.waitForResponse(
    (r) => r.url().includes('/api/v1/notifications/preferences') && r.request().method() === 'PUT',
  )
  await sw().click()
  expect((await restore).status()).toBe(200)
})
