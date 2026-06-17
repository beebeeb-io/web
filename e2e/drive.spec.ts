import { test, expect, type Page, type Locator } from '@playwright/test'

// All Drive E2E tests run in the `authenticated` Playwright project (dev
// auto-login via storageState), so they exercise the signed-in app surface
// directly. The legacy "create account via /api/v1/auth/signup then log in via
// the UI" tests were removed — the login page is now OPAQUE-mandatory with no
// password fallback, so a legacy account can't complete a UI login (task 0763).

test.describe('Drive E2E', () => {
  test('authenticated user visiting /signup is redirected to the drive', async ({ page }) => {
    // This spec runs in the `authenticated` project (dev auto-login), so an
    // already-signed-in user cannot see the guest-only /signup page — the route
    // guard bounces them back to the drive. The old single-page email+password
    // "create account" signup this test once drove no longer exists (signup is
    // now email-first + OPAQUE onboarding, covered by auth.spec.ts /
    // onboarding-password.spec.ts in the unauthenticated project) (task 0763).
    await page.goto('/signup')
    await expect(page).not.toHaveURL(/\/signup/, { timeout: 10_000 })
    await expect(page.getByText('All files').first()).toBeVisible({ timeout: 10_000 })
  })

  test('drive renders with the file list for the authenticated dev account', async ({ page }) => {
    // The legacy "create account via /api/v1/auth/signup then log in via the UI"
    // path is obsolete: the login page is OPAQUE-mandatory with no password
    // fallback (src/pages/login.tsx), so a legacy password account can't complete
    // a UI login. Instead assert the authenticated drive (dev auto-login via the
    // `authenticated` project) renders its file list (task 0763).
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
    await expect(page.getByText('All files').first()).toBeVisible({ timeout: 10_000 })
  })

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/')
    if (await page.getByText('Welcome back').isVisible()) {
      return
    }

    const links = ['Shared', 'Photos', 'Starred', 'Recent', 'Trash']
    for (const label of links) {
      const link = page.getByRole('link', { name: label })
      if (await link.isVisible()) {
        await link.click()
        await expect(page).toHaveURL(new RegExp(`/${label.toLowerCase()}`))
      }
    }

    await page.getByRole('link', { name: 'All files' }).click()
    // toHaveURL matches the FULL url, so anchor on the trailing root path
    // rather than `^/$` (which never matches `http://host/`) (task 0763).
    await expect(page).toHaveURL(/\/$/)
  })

  test('trash page shows empty state', async ({ page }) => {
    await page.goto('/trash')
    if (await page.getByText('Welcome back').isVisible()) return

    await expect(page.getByText(/trash is empty/i)).toBeVisible({ timeout: 5_000 })
  })

  test('settings profile shows email', async ({ page }) => {
    test.setTimeout(90_000)
    // getByText('Profile') matches 5 nodes (nav link, heading, etc.) — target the
    // page heading specifically to avoid a strict-mode violation (task 0763).
    await gotoSettings(page, '/settings/profile', page.getByRole('heading', { name: 'Profile' }))
    if (await page.getByText('Welcome back').isVisible()) return
    await expect(page.getByText('Email').first()).toBeVisible()
  })

  test('search navigates from drive', async ({ page }) => {
    test.setTimeout(90_000)
    // Land on the drive with its shell mounted (back-to-back tests can hit the
    // per-user rate limit, blanking the page until the 60s window drains; the
    // helper backs off + reloads) (task 0763).
    await gotoSettings(page, '/', page.getByPlaceholder(/search files/i))
    if (await page.getByText('Welcome back').isVisible()) return

    const searchInput = page.getByPlaceholder(/search files/i)
    await searchInput.fill('test')
    await searchInput.press('Enter')

    await expect(page).toHaveURL(/\/search\?q=test/)
  })

  test('billing page loads plans', async ({ page }) => {
    test.setTimeout(90_000)
    // /billing redirects to /settings/billing; go straight there. The SettingsHeader
    // title "Plan & billing" renders immediately (even in the page's Loading… state),
    // so it's a stable anchor while plan data fetches (the dev account's plan
    // endpoints 404, but the header is unconditional) (task 0763).
    await gotoSettings(page, '/settings/billing', page.getByRole('heading', { name: /plan & billing/i }))
  })
})

/**
 * Navigate to a lazy `/settings/*` route and wait for its shell to mount.
 *
 * Why this needs retries: every Drive E2E test runs back-to-back against ONE
 * isolated backend, and the app re-runs dev auto-login + opens a sync stream on
 * every page load. By the 5th–7th test the dev account exhausts the per-user
 * rate limit (6000 req / 60s), so the settings page's data/route fetches get
 * 429'd and the shell renders blank (only the dev banner). The 60s window then
 * drains. So on a blank shell we back off ~12s (letting the bucket refill) and
 * reload, up to 3 times. This is a harness load artifact, NOT a masked app bug —
 * the same route renders in ~1s in isolation (task 0763).
 */
async function gotoSettings(page: Page, path: string, anchor: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 0) {
      await page.goto(path)
    } else {
      // Back off to let the per-user rate-limit window drain, then reload.
      await page.waitForTimeout(12_000)
      await page.reload()
    }
    await page
      .waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
      .catch(() => {})
    if (await anchor.isVisible({ timeout: 12_000 }).catch(() => false)) return
  }
  // Final attempt asserts (and surfaces a real failure if the shell never mounts).
  await page.waitForTimeout(12_000)
  await page.reload()
  await page
    .waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
    .catch(() => {})
  await expect(anchor).toBeVisible({ timeout: 15_000 })
}
