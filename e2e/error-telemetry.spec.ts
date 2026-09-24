import { test, expect } from '@playwright/test'

const INGEST = /errors\.beebeeb\.io\/api\/\d+\/envelope\//

// Task 1369b: the "Error reports" settings card renders `isTelemetryConfigured()
// && <ErrorReportsCard />` — it must not exist in the DOM at all while telemetry
// has no DSN wired up (the shipped state until errors.beebeeb.io has DNS). Before
// this fix the card rendered unconditionally, offering an opt-in that silently
// sent nothing — this test was RED on main (the card was present with no DSN).
test('the error reports card is absent when telemetry has no DSN configured', async ({ page }) => {
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
