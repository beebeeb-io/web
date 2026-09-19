import { test, expect } from '@playwright/test'
import path from 'path'
import { mkdirSync } from 'fs'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

/**
 * Opt-in only. The default CI/harness run executes every `e2e/*.spec.ts`
 * against a fresh backend with NO Helsinki pool seeded, so this spec would
 * fail red there — it needs an API booted with a LIVE second pool
 * (continent=helsinki, provider=local, is_active=true) which requires an API
 * restart to pick up (`StorageRegistry` only gets a live `BlobStore` client
 * for a pool after restart — see the comment block below).
 *
 * Recipe to run this spec for real (the 1416 step-3 rung):
 *   1. Through the real admin API, seed:
 *        POST /api/v1/admin/regions        (a region row)
 *        POST /api/v1/admin/datacenters     (a datacenter row bound to it)
 *        POST /api/v1/admin/storage-pools   ({ provider: "local", continent: "helsinki", is_active: true })
 *   2. Restart the API — new pools only get a live client after a restart;
 *      `is_active` toggles alone apply live, but a brand-new pool does not.
 *   3. Run just this spec with the gate open:
 *        E2E_LIVE_REGION=1 bunx playwright test e2e/1416-live-region-picker.spec.ts
 */
test.skip(!process.env.E2E_LIVE_REGION, 'needs an API booted with a live second pool (continent=helsinki); run via the 1416 step-3 recipe with E2E_LIVE_REGION=1')

/**
 * Task 1416, step 3 — the last open rung: prove a region flipped live
 * end-to-end reaches the WEB region picker, not just `GET /api/v1/regions`.
 *
 * Server-side proof (captured separately, not by this spec): a `storage_pools`
 * row with `continent='helsinki'`, `provider='local'`, `is_active=true`,
 * `lifecycle_phase='active'`, bound to an admin-created `regions`/`datacenters`
 * row, created via the real admin API (`POST /api/v1/admin/regions`,
 * `/admin/datacenters`, `/admin/storage-pools`) against an isolated API+DB —
 * then the API restarted so `StorageRegistry` picks up a live local
 * `BlobStore` client for it (`storage.rs::list_regions()` requires
 * `has_pool_client`, task 1416 step 1 — a pool with no live client must
 * never leak into the public list). Evidence: docs/_qa-evidence/1416/step3/.
 *
 * This spec proves the CLIENT half: with helsinki live, `/settings/data-residency`
 * (which reads `GET /api/v1/me/region`'s `available_regions`, server-driven,
 * `src/pages/settings/data-residency.tsx`) renders BOTH regions and the
 * Helsinki card is selectable — `onlyOneRegion = regions.length <= 1` no
 * longer disables the cards once a second live region exists.
 *
 * Relies on the "authenticated" Playwright project (global.setup.ts →
 * dev@beebeeb.dev auto-login against whatever API `E2E_API_URL` points at —
 * for this run, the isolated :3019 instance with the helsinki pool live).
 */

// Defaults to a repo-relative test-results dir (works from any worktree,
// unlike a hardcoded absolute workspace-root path). Override with
// E2E_EVIDENCE_DIR to land screenshots under the workspace's tracked
// docs/_qa-evidence/1416/step3/ for the real step-3 evidence capture — see
// the workspace CLAUDE.md "Multi-repo working directories" for why a
// worktree's own relative paths don't reach that tree.
const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? path.join(process.cwd(), 'test-results', '1416-step3')

test('helsinki region: live in /api/v1/regions AND selectable in the web picker', async ({ page }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true })

  // dev@beebeeb.dev is REUSED across repeated local runs against the same
  // DB (global.setup.ts's dev auto-login) — reset any preference left over
  // from a prior run so `handleSelect`'s `continent === preferred` early
  // return can't turn this run's click into a silent no-op.
  await page.goto('/')
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
  const sessionCookie = (await page.context().cookies()).find((c) => c.name === 'bb_session')
  if (!sessionCookie) throw new Error('bb_session cookie not present before resetting preferred_region')
  const resetRes = await page.request.put(`${API_URL}/api/v1/me/region`, {
    data: { preferred_region: null },
    headers: { Cookie: `bb_session=${sessionCookie.value}` },
  })
  if (!resetRes.ok()) throw new Error(`failed to reset preferred_region: ${resetRes.status()} ${await resetRes.text()}`)

  await page.goto('/settings/data-residency')
  await expect(page.locator('h1, h2').getByText('Data Residency')).toBeVisible({ timeout: 15000 })

  // Wait for the region list to load past the spinner.
  await expect(page.getByText('Loading regions…')).toHaveCount(0, { timeout: 10000 })

  const europeCard = page.getByRole('button', { name: /Europe/ })
  const helsinkiCard = page.getByRole('button', { name: /Helsinki/ })

  await expect(europeCard).toBeVisible()
  await expect(helsinkiCard).toBeVisible()

  // The "more regions coming soon" single-region note must be GONE now that
  // a second live region exists.
  await expect(page.getByText(/More regions coming soon/i)).toHaveCount(0)

  // Helsinki must be a real, clickable card — NOT the disabled/greyed state
  // `onlyOneRegion` produces when only one region is available.
  await expect(helsinkiCard).toBeEnabled()
  await expect(helsinkiCard).not.toHaveClass(/opacity-50/)

  // Location line reads "Helsinki, Finland" (countryFromCity map, data-residency.tsx:27).
  await expect(helsinkiCard.getByText('Helsinki, Finland')).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE_DIR}/1416-step3-both-regions-live.png`, fullPage: true })

  // Selectable = actually selectable, not just enabled: click it and confirm
  // the preference round-trips through PUT /api/v1/me/region.
  await helsinkiCard.click()
  await expect(page.getByText('Region updated')).toBeVisible({ timeout: 10000 })
  await expect(helsinkiCard).toHaveClass(/border-amber-deep/)

  await page.screenshot({ path: `${EVIDENCE_DIR}/1416-step3-helsinki-selected.png`, fullPage: true })
})
