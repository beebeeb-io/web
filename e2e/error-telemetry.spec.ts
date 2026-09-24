import { test, expect } from '@playwright/test'

const INGEST = /errors\.beebeeb\.io\/api\/\d+\/envelope\//

// Task 1369b: the "Error reports" settings card renders only when
// `isTelemetryConfigured() || getTelemetryConsent()` — i.e. it must not exist in
// the DOM at all while telemetry has no DSN wired up (the shipped state until
// errors.beebeeb.io has DNS) AND the user has never opted in. Before this fix the
// card rendered unconditionally, offering an opt-in that silently sent nothing —
// this test was RED on main (the card was present with no DSN).
test('the error reports card is absent when telemetry has no DSN configured and no prior consent', async ({ page }) => {
  test.skip(
    !!process.env.VITE_ERROR_REPORTING_DSN,
    'this run has a DSN baked into the served build — see the "present" test below',
  )
  await page.goto('/settings/privacy')
  // Prove the page actually loaded before asserting an absence — an
  // absence on a blank/broken page is not evidence of the gate working.
  await expect(page.getByText('Restrict processing')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Send error reports')).toHaveCount(0)
})

// Codex P2 on this same PR: a user who opted in during an earlier window when a
// DSN WAS configured must still be able to see and revoke that — the card must
// not just vanish out from under a stranded "on", because a later deploy that
// restores the DSN would then resume reporting before they ever got a chance to
// look at this setting again. The toggle must also refuse to re-enable while
// still unconfigured (no DSN to opt in to).
test('a stranded opt-in (consent on, no DSN) stays visible and revocable, but cannot be re-enabled', async ({ page }) => {
  test.skip(
    !!process.env.VITE_ERROR_REPORTING_DSN,
    'this run has a DSN baked into the served build — the stranded-consent case needs none',
  )
  // Simulate a user who opted in while a DSN was configured, run in a window
  // where it no longer is — set the raw storage key the reporter itself reads
  // (bb_error_reports), not via the UI, since the UI has no DSN to opt in with.
  // A plain page.evaluate (not addInitScript) so the key is set ONCE and later
  // steps — including the reload that checks the revoke persisted — see the
  // app's own read/write of it, not a script re-injecting "on" before every load.
  await page.goto('/settings/privacy')
  await page.evaluate(() => { window.localStorage.setItem('bb_error_reports', 'on') })
  await page.reload()

  const toggle = page.getByLabel('Send error reports')
  await expect(toggle).toBeVisible({ timeout: 15000 })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // Attempting to re-enable while unconfigured is a no-op — click it (still on),
  // click again (now off, the actual revoke), then a third click must NOT flip
  // it back on.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  // Revoked consent is durable: a fresh load with no stranded "on" left in
  // storage now hides the card again, same as the never-opted-in case above.
  await page.reload()
  await expect(page.getByText('Restrict processing')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Send error reports')).toHaveCount(0)
})

test('the toggle renders with the honest copy once telemetry has a DSN', async ({ page }) => {
  // Only meaningful with VITE_ERROR_REPORTING_DSN set for this test run (see
  // e2e/scripts/error-telemetry-dsn.sh / package.json's test:e2e:telemetry) —
  // main.tsx's initTelemetry() is a guaranteed no-op on an empty DSN
  // (errors.beebeeb.io has no DNS record yet, task 1369), and NO real or fake
  // DSN is committed as a default anywhere. Without the env var this test's own
  // assertions (not the app) fail loudly rather than silently pass on a no-op.
  test.skip(!process.env.E2E_ERROR_TELEMETRY, 'set VITE_ERROR_REPORTING_DSN + E2E_ERROR_TELEMETRY=1 to run')
  await page.goto('/settings/privacy')
  await expect(page.getByText('Send error reports')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Off by default.')).toBeVisible()
  await expect(page.getByText('Falkenstein, Germany')).toBeVisible()
})

test('sends nothing while consent is off', async ({ page }) => {
  const hits: string[] = []
  page.on('request', (r) => { if (INGEST.test(r.url())) hits.push(r.url()) })
  await page.goto('/settings/privacy')
  await page.evaluate(() => { window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
    promise: Promise.reject(new Error('e2e forced failure')), reason: new Error('e2e forced failure'),
  })) })
  await page.waitForTimeout(1500)
  expect(hits).toHaveLength(0)
})

test('sends a scrubbed envelope once consent is on', async ({ page }) => {
  // Only runs meaningfully with VITE_ERROR_REPORTING_DSN set for this test run (see
  // e2e/scripts/error-telemetry-dsn.sh / package.json's test:e2e:telemetry) — main.tsx's
  // initTelemetry() is a guaranteed no-op on an empty DSN (errors.beebeeb.io has no DNS
  // record yet, task 1369), and NO real or fake DSN is committed as a default anywhere.
  // Without the env var this test's own assertions (not the app) will fail loudly rather
  // than silently pass on a no-op.
  test.skip(!process.env.E2E_ERROR_TELEMETRY, 'set VITE_ERROR_REPORTING_DSN + E2E_ERROR_TELEMETRY=1 to run')

  const bodies: string[] = []
  await page.route(INGEST, async (route) => {
    bodies.push(route.request().postData() ?? '')
    await route.fulfill({ status: 200, body: '' })
  })
  await page.goto('/settings/privacy')
  await page.getByLabel('Send error reports').click()
  await page.evaluate(() => {
    const err = new Error('cannot decrypt "Holiday photos 2026.jpeg" for bb_sess_9xKq2mZr8vTn4pLd0eWc')
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.reject(err), reason: err,
    }))
  })
  await expect.poll(() => bodies.length, { timeout: 10000 }).toBeGreaterThan(0)
  expect(bodies[0]).not.toContain('Holiday')
  expect(bodies[0]).not.toContain('9xKq2mZr8vTn4pLd0eWc')
  expect(bodies[0]).toContain('"client":"web"')
})
