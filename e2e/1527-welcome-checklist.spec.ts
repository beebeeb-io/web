/**
 * Task 1527 — the welcome checklist closed for good after the FIRST step,
 * not after all of them. Guus on prod (349fa5a): "now the upload file
 * closes the welcome board directly but i wasn't finished with the 2FA
 * etc. so thats wrong."
 *
 * Root cause (welcome-tour.tsx, at 349fa5a): every step action called
 * `onCompleteStep` AND `onClose`, and drive.tsx's `onClose` persists
 * `welcome_tour { seen: true }` — so the checklist never reopened, and the
 * upload step was marked done the instant the picker OPENED (even on
 * cancel). The footer promises "Find this in Settings anytime" but nothing
 * reopened it (0 hits for `welcome_tour|WelcomeTour` outside drive.tsx +
 * the component itself).
 *
 * Real stack (run via e2e/scripts/web-e2e.sh). Each case is a fresh
 * account — the checklist only renders once the cookie banner is
 * answered (welcome-tour.tsx: `if (!open || !cookieConsent) return null`).
 */
import { test, expect } from '@playwright/test'
import { signupAndUnlock } from './helpers/signup'

// A brand-new account each time: override the [authenticated] project's
// dev auto-login state, same as 1526's spec.
test.use({ storageState: { cookies: [], origins: [] } })

async function signUpToChecklist(page: import('@playwright/test').Page, password: string) {
  // ?nodev=1 switches off the dev auto-login for this tab (src/lib/dev-auth.ts)
  // so /signup shows the real form.
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { password })

  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()

  // Anchor on the WELCOME checklist itself (the spotlight OnboardingTour
  // also has an 'Upload your first file' title, so that text alone is
  // ambiguous — same disambiguation as 1526's spec).
  const intro = page.getByText('A few things to get the most out of your encrypted vault.')
  await expect(intro).toBeVisible({ timeout: 20_000 })
  return intro
}

test('1527: picking a file marks "upload" done and keeps the checklist open', async ({ page }) => {
  const intro = await signUpToChecklist(page, 'WelcomeChecklist1527Upload!')

  const uploadButton = page.getByRole('button', { name: /^Upload a file$/ })
  if (!(await uploadButton.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Upload your first file/ }).click()
  }
  await expect(uploadButton).toBeVisible({ timeout: 5_000 })

  const chooser = page.waitForEvent('filechooser', { timeout: 5_000 })
  await uploadButton.click()
  const fileChooser = await chooser
  await fileChooser.setFiles({
    name: 'welcome-1527.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('welcome checklist upload smoke test — task 1527'),
  })

  // The bug: the click ALSO called onClose(), so the board vanished the
  // instant the file was picked (or even the instant the picker opened,
  // before any file was chosen). Assert it is still there, at 1/4, with the
  // upload step's own action button gone (i.e. genuinely marked done, not
  // just still expanded).
  await expect(intro).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('1/4', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(uploadButton).toBeHidden({ timeout: 10_000 })
})

test('1527: "Set up 2FA" hides the checklist, and it reopens with the same progress on the next visit', async ({ page }) => {
  const intro = await signUpToChecklist(page, 'WelcomeChecklist1527TwoFactor!')

  // 'upload' is the first incomplete step, so it's expanded by default —
  // click the 2FA step's own row to expand it and reveal its action button.
  await page.getByRole('button', { name: 'Set up two-factor auth' }).click()
  const setup2fa = page.getByRole('button', { name: /^Set up 2FA$/ })
  await expect(setup2fa).toBeVisible({ timeout: 5_000 })
  await setup2fa.click()

  await expect(page).toHaveURL(/\/settings\/security/, { timeout: 15_000 })

  // Full reload back to the drive — the RCA bug persisted seen:true on this
  // same click, so the checklist would stay gone forever from here on.
  await page.goto('/?nodev=1')
  await expect(page.getByText('All files').first()).toBeVisible({ timeout: 15_000 })
  await expect(intro).toBeVisible({ timeout: 15_000 })
  // Progress is unchanged: clicking through to the setup page is not the
  // same as actually enabling 2FA (this account never went past navigating
  // there), so it must still read 0/4.
  await expect(page.getByText('0/4', { exact: true })).toBeVisible({ timeout: 10_000 })
})

test('1527: "Skip for now" closes the checklist for good, even after a reload', async ({ page }) => {
  const intro = await signUpToChecklist(page, 'WelcomeChecklist1527Skip!')

  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(intro).toBeHidden({ timeout: 5_000 })

  await page.goto('/?nodev=1')
  await expect(page.getByText('All files').first()).toBeVisible({ timeout: 15_000 })
  await expect(intro).toBeHidden({ timeout: 5_000 })
})

test('1527: the Settings entry ("Show welcome checklist") reopens it', async ({ page }) => {
  const intro = await signUpToChecklist(page, 'WelcomeChecklist1527Settings!')

  // Close it first so the assertion below proves the Settings entry
  // reopens it, rather than it simply never having closed.
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(intro).toBeHidden({ timeout: 5_000 })

  await page.goto('/settings/appearance')
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible({ timeout: 15_000 })

  const reopenButton = page.getByRole('button', { name: 'Show welcome checklist' })
  await expect(reopenButton).toBeVisible({ timeout: 10_000 })
  await reopenButton.click()

  await expect(page).toHaveURL(/\/(?:$|\?|#)/, { timeout: 15_000 })
  await expect(intro).toBeVisible({ timeout: 15_000 })
})
