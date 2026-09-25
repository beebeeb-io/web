/**
 * Task 1526 — the first-run "Welcome" checklist's "Upload a file" button did
 * nothing: drive.tsx rendered <WelcomeTour> without an `onUpload` prop, and the
 * upload step has no `href`, so the click handler fell through both branches.
 * Found on prod by Guus on a brand-new account (2026-09-25): zero upload
 * requests reached the API.
 *
 * Real stack (run via e2e/scripts/web-e2e.sh): a fresh account lands on the
 * drive with the welcome tour open; clicking "Upload a file" must open the OS
 * file chooser (the same picker the empty-drive "Upload" uses).
 */
import { test, expect } from '@playwright/test'
import { signupAndUnlock } from './helpers/signup'

// A brand-new account: override the [authenticated] project's dev auto-login state.
test.use({ storageState: { cookies: [], origins: [] } })

test('1526: welcome tour "Upload a file" opens the file chooser for a new account', async ({ page }) => {
  // ?nodev=1 switches off the dev auto-login for this tab (src/lib/dev-auth.ts) so /signup shows the real form.
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { password: 'WelcomeTourUpload1526!' })

  // The welcome checklist only renders once the cookie notice is answered
  // (welcome-tour.tsx: `if (!open || !cookieConsent) return null`).
  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()

  // Anchor on the WELCOME checklist itself (the spotlight OnboardingTour also
  // has an 'Upload your first file' title, so that text alone is ambiguous).
  const intro = page.getByText('A few things to get the most out of your encrypted vault.')
  await expect(intro).toBeVisible({ timeout: 20_000 })
  const uploadButton = page.getByRole('button', { name: /^Upload a file$/ })
  if (!(await uploadButton.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Upload your first file/ }).click()
  }
  await expect(uploadButton).toBeVisible({ timeout: 5_000 })

  const chooser = page.waitForEvent('filechooser', { timeout: 5_000 })
  await uploadButton.click()
  await chooser
})
