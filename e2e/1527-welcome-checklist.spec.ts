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
import { test, expect, type Page } from '@playwright/test'
import { signupAndUnlock } from './helpers/signup'

// A brand-new account each time: override the [authenticated] project's
// dev auto-login state, same as 1526's spec.
test.use({ storageState: { cookies: [], origins: [] } })

/** API origin the served app talks to — mirrors playwright.config.ts's own
 *  E2E_API_URL wiring (web-e2e.sh sets this to its isolated :3003 backend). */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

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

/**
 * Uploads one file through the drive's own TOOLBAR upload button
 * (`aria-label="Upload files"`, drive.tsx ~2241 — `browse`), not the welcome
 * checklist's own upload step. Needed for cases where the board has already
 * been dismissed and so has no upload button of its own, but must still
 * exercise the exact code path the bug lived in: queueResolvedUploads →
 * markTourStepDone('upload') (drive.tsx). Deliberately NOT the empty-drive
 * state's "Upload first file" button — every fresh signup already has a
 * seed file ("Welcome to Beebeeb.md"), so EmptyDrive never renders here.
 * Waits for the upload card to appear (queued) and then disappear (done) so
 * the preference write markTourStepDone fires is complete before the caller
 * reloads.
 */
async function uploadViaToolbarButton(page: Page, name: string): Promise<void> {
  const uploadButton = page.getByRole('button', { name: 'Upload files' })
  await expect(uploadButton).toBeVisible({ timeout: 10_000 })
  const chooser = page.waitForEvent('filechooser', { timeout: 5_000 })
  await uploadButton.click()
  const fileChooser = await chooser
  await fileChooser.setFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(`task 1527 fix-round — ${name}`),
  })
  const uploadCard = page.getByTestId('upload-card').filter({ hasText: name })
  await expect(uploadCard).toBeVisible({ timeout: 10_000 })
  await expect(uploadCard).toBeHidden({ timeout: 20_000 })
}

/**
 * Writes `welcome_tour` directly via the API (not through the UI), sharing
 * the browser context's cookie jar the same way `page.request` does in the
 * 1493 spec (`fetchPasskeyCount`) — httpOnly `bb_session` rides along
 * automatically. Used to seed "this account already dismissed the
 * checklist" WITHOUT ever calling the in-session onClose handler, so the
 * seen value can only have reached this session through the mount effect's
 * own read of the real preference — exactly the path every EXISTING user
 * (dismissed before this fix shipped) is in.
 */
async function setWelcomeTourPreference(page: Page, seen: boolean, completed: string[] = []): Promise<void> {
  const res = await page.request.put(`${API_URL}/api/v1/preferences/welcome_tour`, {
    data: { seen, completed },
  })
  expect(res.ok(), `PUT /api/v1/preferences/welcome_tour failed: ${res.status()} ${await res.text()}`).toBe(true)
}

/**
 * Reloads the drive and waits for the mount effect's own GET of
 * `welcome_tour` to come back — NOT just for "All files" to render — before
 * the caller asserts on board visibility. Without this, `intro` can read as
 * "hidden" purely because the reload is young and the async preference
 * fetch that would reopen it (under the bug) hasn't resolved yet, which
 * would make a mutation-testing run of the reopened-board bug flaky instead
 * of reliably red.
 */
async function reloadDriveAndWaitForWelcomeTourFetch(page: Page): Promise<void> {
  const prefFetched = page.waitForResponse(
    (res) => res.url().includes('/preferences/welcome_tour') && res.request().method() === 'GET',
    { timeout: 15_000 },
  )
  await page.goto('/?nodev=1')
  await prefFetched
  await expect(page.getByText('All files').first()).toBeVisible({ timeout: 15_000 })
}

/**
 * Clicks "Skip for now" and waits for the seen:true PUT it fires to land.
 * drive.tsx writes it fire-and-forget, so a spec that navigates on the very
 * next line can abort it in flight under load and then (correctly) find the
 * board back — a harness race, seen once in an E2E_REPEAT=2 run on
 * 2026-09-26 (test "Skip for now closes the checklist for good").
 */
async function skipChecklist(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (res) => res.url().includes('/preferences/welcome_tour') && res.request().method() === 'PUT',
    { timeout: 15_000 },
  )
  await page.getByRole('button', { name: 'Skip for now' }).click()
  expect((await saved).ok(), 'PUT welcome_tour {seen:true} failed').toBe(true)
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

  await skipChecklist(page)
  await expect(intro).toBeHidden({ timeout: 5_000 })

  await page.goto('/?nodev=1')
  await expect(page.getByText('All files').first()).toBeVisible({ timeout: 15_000 })
  await expect(intro).toBeHidden({ timeout: 5_000 })
})

test('1527: the Settings entry ("Show welcome checklist") reopens it', async ({ page }) => {
  const intro = await signUpToChecklist(page, 'WelcomeChecklist1527Settings!')

  // Close it first so the assertion below proves the Settings entry
  // reopens it, rather than it simply never having closed.
  await skipChecklist(page)
  await expect(intro).toBeHidden({ timeout: 5_000 })

  await page.goto('/settings/appearance')
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible({ timeout: 15_000 })

  const reopenButton = page.getByRole('button', { name: 'Show welcome checklist' })
  await expect(reopenButton).toBeVisible({ timeout: 10_000 })
  await reopenButton.click()

  await expect(page).toHaveURL(/\/(?:$|\?|#)/, { timeout: 15_000 })
  await expect(intro).toBeVisible({ timeout: 15_000 })
})

test('1527: skip → upload a file → reload — the board stays gone', async ({ page }) => {
  // Lead-review fix-round: markTourStepDone (drive.tsx) persisted
  // `seen: false` UNCONDITIONALLY, run from queueResolvedUploads on every
  // upload. A user who had just pressed "Skip for now" (seen:true) would
  // have that immediately clobbered back to false by their very next
  // upload, reopening the board on the following visit.
  const intro = await signUpToChecklist(page, 'WelcomeChecklist1527SkipThenUpload!')

  await skipChecklist(page)
  await expect(intro).toBeHidden({ timeout: 5_000 })

  // The checklist is gone, so it has no upload button of its own here —
  // use the drive's empty-state button, which reaches the same
  // queueResolvedUploads → markTourStepDone('upload') call.
  await uploadViaToolbarButton(page, 'welcome-1527-skip-then-upload.txt')

  await reloadDriveAndWaitForWelcomeTourFetch(page)
  await expect(intro).toBeHidden({ timeout: 5_000 })
})

test('1527: board already dismissed (seen:true) before any in-session action → upload → reload — stays gone', async ({ page }) => {
  // Distinct from the "skip → upload" case above: here `seen:true` is never
  // set via this session's onClose handler at all — it is seeded directly
  // through the API, the same way an account that dismissed the checklist
  // in an EARLIER session (or before this feature/fix ever shipped) would
  // already have it on disk. The only way this session's markTourStepDone
  // can know about it is the mount effect's own read of the real
  // preference (drive.tsx) — this isolates that code path from onClose's.
  const intro = await signUpToChecklist(page, 'WelcomeChecklist1527PreDismissed!')

  await setWelcomeTourPreference(page, true, [])

  // Fresh mount: the mount effect re-reads the preference it just seeded
  // and must neither open the board nor lose track of seen:true.
  await reloadDriveAndWaitForWelcomeTourFetch(page)
  await expect(intro).toBeHidden({ timeout: 5_000 })

  await uploadViaToolbarButton(page, 'welcome-1527-pre-dismissed-upload.txt')

  await reloadDriveAndWaitForWelcomeTourFetch(page)
  await expect(intro).toBeHidden({ timeout: 5_000 })
})

test('1527: upload lands while the welcome_tour GET is still in flight → board stays dismissed, upload still recorded', async ({ page }) => {
  // Flow-3 e2e classification (thumbnail-variant red on main): under load the
  // mount effect's GET /preferences/welcome_tour had not resolved when the
  // spec's upload fired, so markTourStepDone wrote `tourSeenRef`'s DEFAULT
  // (false) back to disk along with a completed set that had lost every
  // earlier step — reopening a dismissed checklist over the drive on the
  // next load. Any real user who drops a file before that one GET returns
  // (slow link, a 429, a 5xx) hits the same thing.
  const intro = await signUpToChecklist(page, 'WelcomeChecklist1527SlowPref!')
  await setWelcomeTourPreference(page, true, ['share'])

  // Hold the mount effect's GET until the upload has fully completed.
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  await page.route('**/api/v1/preferences/welcome_tour', async (route) => {
    if (route.request().method() === 'GET') await gate
    await route.continue()
  })

  await page.goto('/?nodev=1')
  await expect(page.getByText('All files').first()).toBeVisible({ timeout: 15_000 })
  await uploadViaToolbarButton(page, 'welcome-1527-slow-pref-upload.txt')

  const prefFetched = page.waitForResponse(
    (res) => res.url().includes('/preferences/welcome_tour') && res.request().method() === 'GET',
    { timeout: 15_000 },
  )
  release()
  await prefFetched
  // Give a deferred write (the fix) time to land before re-reading.
  await page.waitForTimeout(1_500)
  await page.unroute('**/api/v1/preferences/welcome_tour')

  const res = await page.request.get(`${API_URL}/api/v1/preferences/welcome_tour`)
  expect(res.ok(), `GET welcome_tour failed: ${res.status()}`).toBe(true)
  const stored = (await res.json()) as { value: { seen?: boolean; completed?: string[] } }
  expect(stored.value.seen, 'an upload must never flip a dismissed checklist back to seen:false').toBe(true)
  expect(new Set(stored.value.completed ?? [])).toEqual(new Set(['share', 'upload']))

  await reloadDriveAndWaitForWelcomeTourFetch(page)
  await expect(intro).toBeHidden({ timeout: 5_000 })
})
