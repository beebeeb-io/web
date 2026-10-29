import { expect, type Page } from '@playwright/test'

/**
 * Approve a pending device request (`bb login`, the desktop app) the way a
 * person has to since task 1734: open the approval page with NO code in the
 * link, TYPE the code the device shows, read who is asking, press approve and
 * re-prove the password in the step-up dialog. Resolves on the success screen.
 *
 * Specs used to `goto('/cli-auth?code=XXXX')` and click "Authorize CLI access";
 * that one-click path is exactly the phishing hole the page no longer has.
 */
export async function approveDeviceInPage(
  page: Page,
  opts: { code: string; password: string; webUrl?: string; successTimeout?: number },
): Promise<void> {
  const base = opts.webUrl ?? process.env.E2E_WEB_URL ?? 'http://localhost:5173'
  await page.goto(`${base}/cli-auth`)
  await page.getByLabel('Code from your device').fill(opts.code)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /approve this device/i }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm your identity' })
  await dialog.getByLabel('Password').fill(opts.password)
  await dialog.getByRole('button', { name: 'Approve device' }).click()
  await expect(page.getByText('Device approved')).toBeVisible({ timeout: opts.successTimeout ?? 30_000 })
}
