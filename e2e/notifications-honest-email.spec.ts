import { test, expect, type Page } from '@playwright/test'

/**
 * Flow "Support, help & communication" (fix lane 2, 2026-09-25) —
 * Settings > Notifications must only promise the emails the server sends.
 *
 * Server truth on main (beebeeb-api/src/email.rs + call sites):
 *   - password changed          -> send_password_changed (always sent)
 *   - payment failed            -> send_payment_failed   (always sent, billing)
 *   - plan expiring             -> send_trial_will_end / send_card_expiring (always sent, billing)
 *   - new-device sign-in        -> push only (push_delivery::notify_new_login), NO email
 *   - 2FA enabled/disabled      -> no sender at all
 *   - recovery phrase used      -> no sender at all
 *   - every other event         -> no email sender
 * and no per-type email preference is read server-side (push_delivery.rs reads
 * flat booleans from users.push_preferences; the {email} field is never read).
 *
 * Before this fix the page showed every security row's email switch ON and
 * locked, under the note "Security notifications are always sent via email."
 * Runs in the "authenticated" project (dev auto-login) against the isolated
 * backend started by e2e/scripts/web-e2e.sh.
 */

async function openNotifications(page: Page) {
  await page.goto('/settings/notifications')
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
  await expect(page.getByText('New device sign-in')).toBeVisible({ timeout: 15_000 })
}

const emailSwitch = (page: Page, label: string) =>
  page.getByRole('switch', { name: new RegExp(`^${label} email notifications`) })

test('security section does not promise emails the server never sends', async ({ page }) => {
  await openNotifications(page)

  // The blanket promise is gone.
  await expect(page.getByText(/always sent via email/i)).toHaveCount(0)

  // Not emailed today: switch reads OFF and cannot be turned on.
  for (const label of ['New device sign-in', '2FA changes', 'Recovery phrase used']) {
    const sw = emailSwitch(page, label)
    await expect(sw, `${label} email switch`).toHaveAttribute('aria-checked', 'false')
    await expect(sw, `${label} email switch`).toBeDisabled()
  }

  // Emailed today, unconditionally: switch reads ON and locked.
  const pw = emailSwitch(page, 'Password changed')
  await expect(pw).toHaveAttribute('aria-checked', 'true')
  await expect(pw).toBeDisabled()

  // The note says what actually happens instead.
  await expect(page.getByText(/password changes are always emailed/i)).toBeVisible()
  await page.screenshot({ path: 'test-results/notifications-honest-email.png', fullPage: true })
})

test('email switches reflect what is sent, not an unread preference', async ({ page }) => {
  await openNotifications(page)

  // Billing emails the server always sends.
  for (const label of ['Payment failed', 'Plan expiring']) {
    const sw = emailSwitch(page, label)
    await expect(sw, `${label} email switch`).toHaveAttribute('aria-checked', 'true')
    await expect(sw, `${label} email switch`).toBeDisabled()
  }

  // Events with no email sender: never shown as an enabled email.
  for (const label of [
    'File or folder shared with you',
    'Share link opened',
    'Share access revoked',
    'Storage quota warning',
    'Storage critical',
    'Storage full',
    'Backup complete',
    'Backup failed',
    'Data export ready',
  ]) {
    const sw = emailSwitch(page, label)
    await expect(sw, `${label} email switch`).toHaveAttribute('aria-checked', 'false')
    await expect(sw, `${label} email switch`).toBeDisabled()
  }
})
