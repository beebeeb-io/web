import { test, expect } from '@playwright/test'

const INGEST = /errors\.beebeeb\.io\/api\/\d+\/envelope\//

test('the toggle renders with the honest copy', async ({ page }) => {
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
