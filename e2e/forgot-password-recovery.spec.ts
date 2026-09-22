import { test, expect } from '@playwright/test'

// /forgot-password is a <GuestRoute> (app.tsx) — in dev mode, DevAuthGate's
// devAutoAuth() hits /dev/auto-login on every page load and injects a
// session, which GuestRoute then redirects away from this page before it
// ever renders. Block the dev-only endpoint so this test actually reaches
// the guest-only screen it's testing — same pattern as auth.spec.ts's
// beforeEach.
test.beforeEach(async ({ page }) => {
  await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404 }))
})

test('the recovery-failure state offers a working support path and no dead docs host', async ({ page }) => {
  await page.goto('/forgot-password')
  await page.getByRole('button', { name: 'Show my options' }).click()

  await expect(page.getByText('We cannot recover your account')).toBeVisible()

  // The one link that used to be here pointed at a host with no DNS record.
  await expect(page.locator('a[href*="docs.beebeeb.io"]')).toHaveCount(0)

  const support = page.locator('a[href="mailto:support@beebeeb.io"]')
  await expect(support).toBeVisible()
  await expect(support).toContainText('support@beebeeb.io')

  await expect(page.getByText('What we can still do')).toBeVisible()
  await expect(page.getByText('Do not send us your recovery phrase')).toBeVisible()

  // The impossible instruction belongs on the chooser, not on this screen.
  await expect(page.getByText('sign in on a device that still has access')).toHaveCount(0)

  await page.screenshot({ path: 'test-results/forgot-password-no-recovery.png', fullPage: true })
})
