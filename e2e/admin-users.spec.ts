import { test, expect } from '@playwright/test'
import { envTestAccount, loginAndProvision } from './helpers/auth'

/**
 * E2E coverage for /admin/users — specifically the impersonate + promote +
 * demote flows fixed in task 0018. Pre-fix:
 *  - Impersonate button issued a token but never swapped sessions; just
 *    showed a toast with the first 24 chars. The admin stayed logged in as
 *    themselves.
 *  - Promote button was hardcoded `disabled` with no onClick.
 *
 * Post-fix:
 *  - Impersonate calls `useImpersonation().startImpersonation` which swaps
 *    the auth token and force-reloads the page as the target user. The
 *    `<ImpersonationBanner>` is then visible.
 *  - Promote/Demote call `adminPromote`/`adminDemote` (new in api.ts) and
 *    refresh the drawer's role chip on success.
 *
 * Prerequisites: full local stack + BB_TEST_USER_* env pointing at a
 * SUPERADMIN account. Tests `test.skip()` cleanly when env is missing —
 * same convention as the OPAQUE test in auth.spec.ts.
 *
 * The test currently exercises a single dedicated target account (a regular
 * user) for the promote/demote round-trip. Keep the setup/cleanup symmetric
 * so a re-run from a clean state leaves the DB unchanged.
 */
test.describe('Admin /users drawer — impersonate + promote (regression: task 0018)', () => {
  test('impersonate target user → banner visible after reload', async ({ page }) => {
    const account = envTestAccount()
    test.skip(!account, 'Set BB_TEST_USER_* env vars (superadmin) to run this test')

    await loginAndProvision(page, account!)
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')

    if (!page.url().includes('/admin')) {
      test.skip(true, 'Configured BB_TEST_USER is not admin/superadmin')
    }

    // Open the drawer for the first non-admin user in the list. We pick by
    // looking for a user row WITHOUT an admin/superadmin chip — search "test"
    // would also work if the env account is the seeded test user.
    const firstNonAdminRow = page.getByRole('row').filter({
      hasNot: page.getByText(/^Admin$|^Superadmin$/i),
    }).filter({
      has: page.getByText(/@/),
    }).first()

    await firstNonAdminRow.click()

    // Drawer opens; click Impersonate button (the amber one with the eye icon).
    const impersonateBtn = page.getByRole('button', { name: /^impersonate$/i })
    await expect(impersonateBtn).toBeVisible({ timeout: 5_000 })

    // Auto-accept the confirm() dialog
    page.once('dialog', (d) => d.accept())
    await impersonateBtn.click()

    // Page force-reloads to '/' under the target user's session. The
    // <ImpersonationBanner> at the top of the app should be visible. Match
    // any banner text mentioning "impersonating" or "viewing as".
    await page.waitForURL(/\/$/, { timeout: 15_000 })
    const banner = page.getByText(/impersonating|viewing as/i).first()
    await expect(banner).toBeVisible({ timeout: 10_000 })

    // Stop impersonating restores the admin session.
    const stopBtn = page.getByRole('button', { name: /stop impersonating|return to admin/i })
    await expect(stopBtn).toBeVisible()
    await stopBtn.click()
    await page.waitForURL(/\/admin\/users/, { timeout: 10_000 })

    // Banner gone, admin is back.
    await expect(page.getByText(/impersonating|viewing as/i)).not.toBeVisible()
  })

  test('promote regular user → role chip flips to admin → demote restores', async ({ page }) => {
    const account = envTestAccount()
    test.skip(!account, 'Set BB_TEST_USER_* env vars (superadmin) to run this test')

    await loginAndProvision(page, account!)
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')

    if (!page.url().includes('/admin')) {
      test.skip(true, 'Configured BB_TEST_USER is not admin/superadmin')
    }

    // Pick a non-admin user row (not the env account itself, since the
    // server rejects self-promote with 400 and the UI hides the button when
    // looking at your own row anyway).
    const targetRow = page.getByRole('row').filter({
      hasNot: page.getByText(/^Admin$|^Superadmin$/i),
    }).filter({
      has: page.getByText(/@/),
    }).filter({
      hasNotText: account!.email,
    }).first()

    const targetEmail = await targetRow.getByText(/@/).first().textContent()
    expect(targetEmail).toBeTruthy()

    await targetRow.click()

    // Drawer opens. Promote button label is "Promote to admin" pre-promote.
    const promoteBtn = page.getByRole('button', { name: /^promote to admin$/i })
    await expect(promoteBtn).toBeVisible({ timeout: 5_000 })

    page.once('dialog', (d) => d.accept())
    await promoteBtn.click()

    // Toast appears; role chip in the drawer header flips to "Admin".
    await expect(page.getByText(/promoted to admin/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('[role="dialog"]').getByText(/^admin$/i)).toBeVisible({ timeout: 5_000 })

    // Now the same drawer shows "Demote to user" instead of "Promote to admin".
    const demoteBtn = page.getByRole('button', { name: /^demote to user$/i })
    await expect(demoteBtn).toBeVisible()

    // Demote to clean up — leaves the DB in the original state.
    page.once('dialog', (d) => d.accept())
    await demoteBtn.click()
    await expect(page.getByText(/demoted to user/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /^promote to admin$/i })).toBeVisible({ timeout: 5_000 })
  })
})
