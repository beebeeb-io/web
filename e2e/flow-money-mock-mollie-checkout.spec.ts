/**
 * Money flow on the LOCAL stack — checkout → hosted payment → webhook → active.
 *
 * REAL-STACK spec (no page.route mocks): the isolated harness API is booted
 * with a Mollie TEST key and `MOLLIE_API_BASE` pointed at the server's own
 * debug-only mock Mollie (`/dev/mock-mollie/v2`, server repo
 * `beebeeb-api/src/routes/dev_mock_mollie.rs`). Nothing leaves localhost and
 * no money moves.
 *
 * Before the seam existed, the only local purchase path was the debug-only
 * `/subscribe` mock: `POST /billing/checkout` answered
 * 400 "stripe not configured — use /subscribe for mock billing", so nobody
 * could walk pricing → pay → manage on a laptop.
 *
 * Asserts, end to end:
 *   1. POST /api/v1/billing/checkout (Pro, monthly) → 200 { url } pointing at
 *      the mock hosted checkout (RED today: 400).
 *   2. The browser opens that URL, clicks "Pay", and Mollie's redirect lands
 *      back on /billing?upgraded=true showing "Upgrade complete".
 *   3. The webhook converged the subscription: plan `pro`, status `active`.
 *   4. The storage quota went up (plan_limit_bytes strictly larger than free).
 *
 * Run (own port block, mock Mollie on the API's own origin):
 *   MOLLIE_API_KEY=test_mock_local_e2e \
 *   MOLLIE_API_BASE=http://localhost:3347/dev/mock-mollie/v2 \
 *   E2E_API_PORT=3347 E2E_VITE_PORT=5347 E2E_DB_NAME=beebeeb_web_e2e_money \
 *     bash e2e/scripts/web-e2e.sh e2e/flow-money-mock-mollie-checkout.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'

const API = process.env.E2E_API_URL ?? 'http://localhost:3001'
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

async function sessionCookie(page: Page): Promise<string> {
  const c = (await page.context().cookies()).find((x) => x.name === 'bb_session')
  if (!c) throw new Error('bb_session cookie missing — global.setup did not authenticate')
  return c.value
}

async function api(
  page: Page,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  data?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = await sessionCookie(page)
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    data,
    headers: { Cookie: `bb_session=${token}`, Origin: WEB },
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text }
  }
  return { status: res.status(), body }
}

test('checkout → mock Mollie pay → webhook → plan active + quota raised', async ({ page }) => {
  test.setTimeout(90_000)

  await page.goto(`${WEB}/billing`)

  const before = await api(page, 'GET', '/api/v1/files/usage')
  expect(before.status, JSON.stringify(before.body)).toBe(200)
  const quotaBefore = Number(before.body.plan_limit_bytes)
  expect(quotaBefore).toBeGreaterThan(0)

  // The checkout form's BillingInfoStep PUTs this before creating the session.
  const profile = await api(page, 'PUT', '/api/v1/billing/profile', {
    full_name: 'Money Flow E2E',
    billing_country: 'NL',
    billing_street: 'Teststraat 1',
    billing_postal: '6601 AA',
    billing_city: 'Wijchen',
    customer_type: 'b2c',
  })
  expect(profile.status, JSON.stringify(profile.body)).toBe(200)

  // 1. Checkout must hand back a hosted-payment URL (RED before the seam: 400).
  const checkout = await api(page, 'POST', '/api/v1/billing/checkout', {
    plan: 'pro',
    billing_cycle: 'monthly',
  })
  expect(checkout.status, `checkout: ${JSON.stringify(checkout.body)}`).toBe(200)
  const url = String(checkout.body.url ?? '')
  expect(url).toContain('/dev/mock-mollie/checkout/')

  // 2. Pay on the mock hosted checkout; Mollie redirects back to the app.
  await page.goto(url)
  await expect(page.getByTestId('mock-mollie-checkout')).toBeVisible()
  await page.getByTestId('mock-mollie-pay').click()
  await page.waitForURL(/\/billing\?upgraded=true/, { timeout: 30_000 })
  await expect(page.getByText('Upgrade complete')).toBeVisible({ timeout: 30_000 })

  // 3. The webhook converged the subscription row.
  const sub = await api(page, 'GET', '/api/v1/billing/subscription')
  expect(sub.status, JSON.stringify(sub.body)).toBe(200)
  expect(sub.body.plan).toBe('pro')
  expect(sub.body.status).toBe('active')

  // 4. …and the grant raised the storage quota.
  const after = await api(page, 'GET', '/api/v1/files/usage')
  expect(after.status, JSON.stringify(after.body)).toBe(200)
  expect(Number(after.body.plan_limit_bytes)).toBeGreaterThan(quotaBefore)
})
