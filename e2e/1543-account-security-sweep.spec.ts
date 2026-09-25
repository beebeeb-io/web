import { test, expect, type Page } from '@playwright/test'

/**
 * E2E for task 1543 — web account/security sweep (full bug sweep 2026-09-25).
 * Runs in the "authenticated" project (dev auto-login), one isolated backend
 * per e2e/scripts/web-e2e.sh run.
 *
 * Each test targets one finding from
 * .claude/tasks/backlog/1543-sweep-web-account-security.md and was seen RED
 * against unmodified `main` before the corresponding fix landed (see the
 * task file's Notes section for the RED transcript).
 */

async function waitForCryptoReady(page: Page) {
  await page.waitForFunction(
    () => document.body.dataset.cryptoReady === 'true',
    { timeout: 15_000 },
  )
}

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

/** Force the dev account's activity-tracking preference via the authenticated
 *  cookie already on the page's context (mirrors global.setup.ts's
 *  setWelcomeTourSeen pattern) so finding-7's not-opted-in empty state is
 *  deterministic regardless of what earlier specs in this run did. */
async function setTrackingOptedIn(page: Page, optedIn: boolean) {
  // devAutoAuth stores the raw token in localStorage; AuthContext's boot
  // sequence separately upgrades it to the httpOnly bb_session cookie via
  // POST /auth/upgrade-session, which can lag past data-crypto-ready (same
  // race global.setup.ts's setWelcomeTourSeen polls for).
  await expect
    .poll(
      async () => (await page.context().cookies()).some((c) => c.name === 'bb_session'),
      { message: 'bb_session cookie not present before setTrackingOptedIn', timeout: 10_000 },
    )
    .toBe(true)
  const sessionCookie = (await page.context().cookies()).find((c) => c.name === 'bb_session')
  if (!sessionCookie) throw new Error('bb_session cookie not present before setTrackingOptedIn')
  const res = await page.request.put(`${API_URL}/api/v1/me/tracking`, {
    data: { opted_in: optedIn },
    headers: { Cookie: `bb_session=${sessionCookie.value}` },
  })
  if (!res.ok()) throw new Error(`failed to set tracking preference: ${res.status()} ${await res.text()}`)
}

// ── Finding 1 + 4: bulk "sign out everywhere" + per-session device details ──

test('finding 1+4: Devices & sessions shows real device data and a working bulk sign-out', async ({ page }) => {
  // Every page load re-runs /dev/auto-login (task-1543 investigation: each
  // call inserts a fresh `sessions` row and upgrades the cookie to the new
  // token — see src/lib/dev-auth.ts). Two navigations before we land on the
  // security page guarantee at least one non-current session exists, without
  // depending on test execution order across the file.
  await page.goto('/')
  await waitForCryptoReady(page)
  await page.goto('/settings/security')
  await waitForCryptoReady(page)

  await expect(page.getByText('Devices & sessions')).toBeVisible({ timeout: 15_000 })

  // Finding 4: rows must show real per-session device data (the server's
  // list_sessions endpoint used before this fix returns none; the richer
  // /api/v1/account/sessions endpoint defaults an unnamed device to
  // "Unknown device" — proving the UI now reads real data, not a hardcoded
  // "Session" literal).
  await expect(page.getByText('Unknown device').first()).toBeVisible({ timeout: 10_000 })

  // Finding 1: a bulk "sign out everywhere" action must be reachable.
  const bulkButton = page.getByRole('button', { name: /sign out everywhere/i })
  await expect(bulkButton).toBeVisible({ timeout: 10_000 })
  await bulkButton.click()
  await expect(page.getByText(/signed out of \d+ other/i)).toBeVisible({ timeout: 10_000 })

  // After the bulk action, only the current session remains.
  await expect(page.getByRole('button', { name: /^revoke$/i })).toHaveCount(0)
})

// ── Finding 2: recovery contact must not promise an unimplemented feature ──

test('finding 2: recovery contact field does not promise an unimplemented 180-day notification', async ({ page }) => {
  await page.goto('/settings/profile')
  await waitForCryptoReady(page)
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 15_000 })

  const content = await page.locator('body').textContent() ?? ''
  expect(content).not.toMatch(/notified.*inactive for 180 days/i)
})

// ── Finding 3: a single canonical delete-account flow ───────────────────────

test('finding 3: profile Danger Zone routes to the single canonical delete-account flow', async ({ page }) => {
  await page.goto('/settings/profile')
  await waitForCryptoReady(page)
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 15_000 })

  // The old inline flow asked the user to type their EMAIL — that input must
  // be gone.
  await expect(page.getByPlaceholder(/^Type .+@.+ to confirm$/i)).toHaveCount(0)

  const deleteBtn = page.getByRole('button', { name: /^delete account$/i })
  await expect(deleteBtn).toBeVisible({ timeout: 10_000 })
  await deleteBtn.click()

  await expect(page).toHaveURL(/\/settings\/delete-account/, { timeout: 10_000 })
  // Landed on the canonical page, which gates on the literal word DELETE.
  await expect(page.getByPlaceholder('DELETE')).toBeVisible({ timeout: 10_000 })
})

// ── Finding 5: delete-account copy must not claim a wrong HTTP status ───────

test('finding 5: delete-account page does not claim a specific HTTP status the server does not return', async ({ page }) => {
  await page.goto('/settings/delete-account')
  await expect(page.getByText(/delete your account/i)).toBeVisible({ timeout: 15_000 })

  const content = await page.locator('body').textContent() ?? ''
  expect(content).not.toMatch(/410 Gone/i)
})

// ── Finding 6: Import shows an honest fallback, not a silent dead end ───────

test('finding 6: import page shows an explicit fallback when no provider is configured', async ({ page }) => {
  await page.goto('/settings/import')
  await waitForCryptoReady(page)
  await expect(page.getByRole('heading', { name: 'Import' })).toBeVisible({ timeout: 15_000 })

  // This harness never sets VITE_DROPBOX_APP_KEY / VITE_GOOGLE_CLIENT_ID, so
  // both providers must render an explicit "Coming soon" state rather than
  // nothing at all.
  await expect(page.getByText(/coming soon/i).first()).toBeVisible({ timeout: 10_000 })
  const content = await page.locator('body').textContent() ?? ''
  expect(content).not.toMatch(/VITE_DROPBOX|VITE_GOOGLE|not configured|APP_KEY/)
})

// ── Finding 7: activity-tracking cross-links point where the toggle lives ──

test('finding 7: activity-tracking cross-links consistently point to Settings > Profile', async ({ page }) => {
  await page.goto('/settings/profile')
  await waitForCryptoReady(page)
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 15_000 })
  await setTrackingOptedIn(page, false)

  await page.goto('/settings/activity')
  await waitForCryptoReady(page)
  await expect(page.getByText(/activity tracking is not enabled/i)).toBeVisible({ timeout: 15_000 })
  const activityLink = page.getByRole('link', { name: /settings.*profile/i })
  await expect(activityLink).toBeVisible({ timeout: 10_000 })
  await expect(activityLink).toHaveAttribute('href', '/settings/profile')

  await page.goto('/settings/security')
  await waitForCryptoReady(page)
  await expect(page.getByText('Recent sign-ins')).toBeVisible({ timeout: 15_000 })
  const securityLink = page.getByRole('link', { name: /settings.*profile/i })
  await expect(securityLink).toBeVisible({ timeout: 10_000 })
  await expect(securityLink).toHaveAttribute('href', '/settings/profile')
})
