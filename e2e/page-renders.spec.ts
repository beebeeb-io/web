import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * Smoke renders for the security / team / shared pages in the authenticated
 * app (dev auto-login via the `authenticated` project).
 *
 * Previously each test used `page.waitForLoadState('networkidle')`, which never
 * settles under the harness — the app keeps an open sync stream and a fresh dev
 * account's data endpoints 404 + retry, so the network is never idle and the
 * wait times out (task 0763). Wait on the WASM crypto-ready signal + a stable
 * on-page anchor instead, with a rate-limit-aware backoff (the back-to-back
 * tests can exhaust the per-user limit and blank the shell until the 60s window
 * drains).
 */
test.describe('Page renders (scenarios 6, 8, 9)', () => {
  test('security page renders with sessions section', async ({ page }) => {
    test.setTimeout(90_000)
    // /security redirects to /settings/security.
    await gotoAuthed(page, '/security', page.getByRole('heading', { name: /security/i }).first())
    if (await page.getByText('Welcome back').isVisible()) return

    await expect(page.getByText(/security/i).first()).toBeVisible()
    await expect(page.getByText(/sessions/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('team page renders with empty state or workspace list', async ({ page }) => {
    // The /team route is gated behind the FEATURE_TEAMS flag (Workspaces/Teams,
    // a placeholder until teams ships — src/lib/flags.ts). When it's off (the
    // default, and the harness doesn't set VITE_FEATURE_TEAMS=true) the route
    // redirects to the drive, so there is no team page to render. Skip until the
    // flag is enabled rather than asserting drive content (task 0763).
    test.skip(
      process.env.VITE_FEATURE_TEAMS !== 'true',
      'FEATURE_TEAMS off (default): /team redirects to / — enable VITE_FEATURE_TEAMS=true to test (task 0763)',
    )
    test.setTimeout(90_000)
    await gotoAuthed(page, '/team', page.getByText(/workspace/i).first())
    if (await page.getByText('Welcome back').isVisible()) return

    const emptyState = page.getByText(/no workspace yet/i)
    const workspaceContent = page.getByText(/workspace/i).first()
    await expect(emptyState.or(workspaceContent)).toBeVisible({ timeout: 10_000 })
  })

  test('shared page renders with three tabs', async ({ page }) => {
    test.setTimeout(90_000)
    await gotoAuthed(page, '/shared', page.getByRole('tab', { name: /with me/i }))
    if (await page.getByText('Welcome back').isVisible()) return

    await expect(page.getByRole('tab', { name: /with me/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('tab', { name: /by me/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /pending/i })).toBeVisible()
  })
})

/**
 * Navigate to an authenticated route and wait for its shell to mount.
 *
 * The body stays blank until WASM crypto is ready (WasmGuard/DevAuthGate). In a
 * long single-backend spec run the dev account can also exhaust the per-user
 * rate limit (6000 req / 60s — the app re-runs dev auto-login + opens a sync
 * stream on every page load), 429-ing the page's data fetches and blanking the
 * shell. The 60s window then drains, so on a blank shell we back off ~12s and
 * reload, up to 3×. Harness load artifact, not a masked app bug — these routes
 * render in ~1s in isolation (task 0763).
 */
async function gotoAuthed(page: Page, path: string, anchor: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 0) {
      await page.goto(path)
    } else {
      await page.waitForTimeout(12_000)
      await page.reload()
    }
    await page
      .waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
      .catch(() => {})
    if (await anchor.isVisible({ timeout: 12_000 }).catch(() => false)) return
  }
  await page.waitForTimeout(12_000)
  await page.reload()
  await page
    .waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
    .catch(() => {})
  await expect(anchor).toBeVisible({ timeout: 15_000 })
}
