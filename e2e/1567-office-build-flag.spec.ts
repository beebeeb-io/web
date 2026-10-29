/**
 * Task 1567 — the office editor has ONE gate: the build flag.
 *
 * Ship prep (2026-09-27) briefly added a per-browser Labs opt-in
 * (`?labs=office` → a `bb-office-labs` localStorage flag). Guus dropped it the
 * same day ("Instead of the ?lab=office, just add it in. No real users yet"),
 * so `VITE_FEATURE_OFFICE_EDITOR` alone decides (src/lib/office/office-labs.ts):
 *
 *   flag ON  → a signed-in user sees the preview's "Edit" entry for a .docx and
 *              the `/office/:fileId` route mounts the editor — with NO query
 *              param and NO opt-in key in localStorage.
 *   flag OFF → the "Edit" entry is absent for the same .docx and
 *              `/office/:fileId` redirects to `/`.
 *
 * Asserts only the chrome around the engine (office-editor mounts before the
 * engine boots), so it runs fast; the full edit/save round trip is
 * 1567-office-editor.spec.ts. Run it once per build flavour:
 *
 *   VITE_FEATURE_OFFICE_EDITOR=true E2E_API_PORT=<p> E2E_VITE_PORT=<p> \
 *     ./e2e/scripts/web-e2e.sh e2e/1567-office-build-flag.spec.ts
 *   E2E_API_PORT=<p> E2E_VITE_PORT=<p> \
 *     ./e2e/scripts/web-e2e.sh e2e/1567-office-build-flag.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'
import { writeDocxFixture } from './helpers/office-fixtures'
import { uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'

const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'

test.setTimeout(120_000)

async function dismissDevBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // Never appeared this session.
  }
}

/** No opt-in anywhere: no Labs key in storage, no query param on the URL. */
async function expectNoOptIn(page: Page): Promise<void> {
  expect(await page.evaluate(() => localStorage.getItem('bb-office-labs'))).toBeNull()
  expect(new URL(page.url()).search).toBe('')
}

test('flag on: .docx preview shows Edit and /office/:fileId mounts the editor with no opt-in', async ({ page, context }) => {
  test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true — the flag-off test below covers this build')
  await page.goto('/')
  await dismissDevBanner(page)
  await expectNoOptIn(page)

  const base = await uploadAndWait(page, writeDocxFixture(`office-flag-on-${process.pid}.docx`))
  await dismissDevBanner(page)
  await openPreview(page, base)

  const editButton = previewOverlay(page).getByTestId('preview-edit-button')
  await expect(editButton).toBeVisible({ timeout: 10_000 })

  // Entry point → its own top-level tab at /office/<fileId>, no query.
  const popupPromise = context.waitForEvent('page')
  await editButton.click()
  const officeTab = await popupPromise
  await officeTab.waitForLoadState('domcontentloaded')
  await dismissDevBanner(officeTab)
  const officeUrl = new URL(officeTab.url())
  expect(officeUrl.pathname).toMatch(/^\/office\/[^/]+$/)
  await expectNoOptIn(officeTab)
  await expect(officeTab.getByTestId('office-editor')).toBeVisible({ timeout: 15_000 })
  await officeTab.close()

  // Direct navigation to the route (no entry point, no query) stays put too.
  await page.goto(officeUrl.pathname)
  await dismissDevBanner(page)
  await expect(page.getByTestId('office-editor')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe(officeUrl.pathname)
  await expectNoOptIn(page)
})

test('flag off: .docx preview has no Edit and /office/:fileId redirects to /', async ({ page }) => {
  test.skip(OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR=true — the flag-on test above covers this build')
  await page.goto('/')
  await dismissDevBanner(page)

  const base = await uploadAndWait(page, writeDocxFixture(`office-flag-off-${process.pid}.docx`))
  await dismissDevBanner(page)
  await openPreview(page, base)
  // Positive anchor first — the preview chrome has rendered its actions —
  // so the Edit-absent assertion below is not just "nothing rendered yet".
  await expect(previewOverlay(page).getByRole('button', { name: 'Download' }).first()).toBeVisible({ timeout: 10_000 })
  await expect(previewOverlay(page).getByTestId('preview-edit-button')).toHaveCount(0)

  // Even the old opt-in cannot resurrect a route the build does not carry.
  await page.goto('/?labs=office')
  await page.goto('/office/00000000-0000-0000-0000-000000000000')
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 })
})
