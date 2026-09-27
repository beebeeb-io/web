/**
 * Task 1567 ship prep (2026-09-27) — the office editor's TWO-flag gate.
 *
 * `VITE_FEATURE_OFFICE_EDITOR` (build-time) controls whether the
 * `/office/:fileId` route/chunk exists in a given build at all — for the
 * production image this is now `true` (the route + engine bundle ARE
 * shipped, see Dockerfile / office-bundle-stage.sh), but the feature is
 * still meant to be invisible to ordinary visitors until the founder opts
 * a browser in. `isOfficeLabsEnabled()` (runtime, src/lib/office/office-labs.ts)
 * is that per-visitor opt-in: a `bb-office-labs` localStorage flag, settable
 * by visiting any URL with `?labs=office` once.
 *
 * This spec exercises ONLY the route-level gate — it asserts on `page.url()`
 * right after navigation, before the engine would even start booting, so it
 * needs no `public/office/` engine bundle and runs fast. The OTHER half
 * (opted-in, a real docx actually opens/edits/saves) is covered by
 * 1567-office-editor.spec.ts and, for a real prod-shaped image, by the
 * container-level Playwright check in docs/DEPLOYMENT.md's office-editor
 * ship-prep note.
 *
 * Run:
 *   VITE_FEATURE_OFFICE_EDITOR=true E2E_API_PORT=<port> E2E_VITE_PORT=<port> \
 *     ./e2e/scripts/web-e2e.sh e2e/1567-office-labs-flag.spec.ts
 *
 * (Also meaningful with VITE_FEATURE_OFFICE_EDITOR unset/false — the
 * "labs on but build flag off" case below asserts the build flag alone
 * still blocks it, which is the "ship prep" gate's whole point: the
 * production image being ABLE to serve the route is not the same as every
 * visitor seeing it.)
 */
import { test, expect } from '@playwright/test'

const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'

test('office route redirects to / when Labs is not opted in, even with the build flag on', async ({ page }) => {
  test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true — this build has the route compiled out anyway')
  await page.goto('/office/00000000-0000-0000-0000-000000000000')
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 })
})

test('office route stays reachable once ?labs=office has been visited (persisted via localStorage)', async ({ page }) => {
  test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true — this build has the route compiled out anyway')
  // One visit with the param — office-labs.ts persists it to localStorage.
  await page.goto('/?labs=office')
  const flag = await page.evaluate(() => localStorage.getItem('bb-office-labs'))
  expect(flag).toBe('true')
  // A LATER navigation, no param this time — still opted in.
  await page.goto('/office/00000000-0000-0000-0000-000000000000')
  await expect(page).toHaveURL(/\/office\//, { timeout: 10_000 })
  await expect(page).not.toHaveURL(/\/$/)
})

test('office route redirects to / regardless of Labs when the build flag itself is off', async ({ page }) => {
  test.skip(OFFICE_FLAG_ON, 'this build has VITE_FEATURE_OFFICE_EDITOR=true — the negative build-flag case does not apply')
  await page.goto('/?labs=office')
  await page.goto('/office/00000000-0000-0000-0000-000000000000')
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 })
})
