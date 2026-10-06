/**
 * 1743 — the public "return to the app" page that a native app's Mollie checkout
 * lands on (spec 4.3 / 5.9; server `checkout_return::APP_RETURN_PATH`).
 *
 * Test 1 (no server): the page is reachable with no session, never bounces to /login
 *   even when every API call answers 401 (the system browser holds no web session),
 *   fits a phone width without horizontal scroll, and renders in light and dark.
 * Test 2 (the real rung, opt-in): against a LOCAL debug API wired to its built-in mock
 *   Mollie (`MOLLIE_API_KEY=test_mock_local`, `MOLLIE_API_BASE=<api>/dev/mock-mollie/v2`,
 *   `API_URL=<api>`, `APP_URL=<web>`), a seeded account asks `POST /billing/checkout`
 *   for `return_kind: "app"`, the browser opens the hosted checkout, presses Pay, and
 *   must land on `<web>/return-to-app`. Needs E2E_API_URL and E2E_1743_TOKEN (the raw
 *   session token of an account that has a billing profile). Skipped without them;
 *   a skip is reported, so the run's count tells which rung ran.
 *
 * Run: E2E_WEB_URL=http://localhost:<vite> bunx playwright test --config=e2e/1743-return-to-app.config.ts
 */
import { test, expect } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? path.join('test-results', '1743')
const shot = (name: string) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  return path.join(EVIDENCE, name)
}

test('the return page is public: no login bounce, no horizontal scroll, light and dark', async ({ page }) => {
  const apiHits: string[] = []
  // Every API call fails like an anonymous session would: the app's boot getMe() is a 401.
  // `/api/v1/` only: a bare `**/api/**` also matches the dev server's own packages/shared/src/api/*.ts modules.
  await page.route('**/api/v1/**', async (route) => {
    apiHits.push(new URL(route.request().url()).pathname)
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' })
  })

  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/return-to-app')
  await expect(page.getByRole('heading', { name: 'Return to the Beebeeb app' })).toBeVisible()
  await expect(page.getByTestId('return-to-app-note')).toContainText('may not have completed')

  // Give the boot-time session probe time to fail and the 401 handler time to (wrongly) navigate.
  await page.waitForTimeout(1500)
  expect(new URL(page.url()).pathname, 'a 401 must not bounce this page to /login').toBe('/return-to-app')
  expect(apiHits.filter((p) => p.includes('/billing/')), 'the page itself calls no billing endpoint').toEqual([])

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'no horizontal scroll at 390px').toBeLessThanOrEqual(0)

  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: shot('return-to-app-390-light.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: shot('return-to-app-390-dark.png'), fullPage: true })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: shot('return-to-app-1280-light.png') })

  // The one link goes to Billing on the web (a real anchor, not a button).
  const link = page.getByTestId('return-to-app-billing')
  expect(await link.evaluate((el) => el.tagName)).toBe('A')
  await expect(link).toHaveAttribute('href', '/billing')
})

test('a stale session token (expired session) does not bounce the return page to /login', async ({ page }) => {
  // The system browser CAN hold an old web session. Its boot getMe() then 401s as an
  // authenticated call, which fires the global session-expired handler (navigate to
  // /login) unless the path is in App.tsx's PUBLIC_ROUTE_PATTERNS.
  await page.addInitScript(() => localStorage.setItem('bb_session', 'stale-token-from-an-old-session'))
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }),
  )
  await page.goto('/return-to-app')
  await expect(page.getByRole('heading', { name: 'Return to the Beebeeb app' })).toBeVisible()
  await page.waitForTimeout(1500)
  expect(new URL(page.url()).pathname, 'the session-expired handler must not navigate away').toBe('/return-to-app')
  await expect(page.getByRole('heading', { name: 'Return to the Beebeeb app' })).toBeVisible()
})

const API = process.env.E2E_API_URL
const TOKEN = process.env.E2E_1743_TOKEN

test('real rung: mock Mollie checkout with return_kind app lands on the return page', async ({ page, request }) => {
  test.skip(!API || !TOKEN, 'needs E2E_API_URL + E2E_1743_TOKEN (local API with mock Mollie)')
  const auth = { Authorization: `Bearer ${TOKEN}` }

  const res = await request.post(`${API}/api/v1/billing/checkout`, {
    headers: auth,
    data: { plan: 'starter', billing_cycle: 'monthly', return_kind: 'app' },
  })
  expect(res.status(), await res.text()).toBe(200)
  const { url } = (await res.json()) as { url: string }
  expect(url).toContain('/dev/mock-mollie/checkout/')

  // A URL in the request is refused, not followed (the server-side proof is in its test suite;
  // this is the same refusal through the real HTTP stack).
  const bad = await request.post(`${API}/api/v1/billing/checkout`, {
    headers: auth,
    data: { plan: 'starter', billing_cycle: 'monthly', return_url: 'https://evil.example' },
  })
  expect(bad.status()).toBe(400)
  expect((await bad.json()).error).toBe('return_url_not_accepted')

  // The browser holds NO web session: open the hosted checkout, press Pay.
  await page.goto(url)
  await page.screenshot({ path: shot('real-1-mock-hosted-checkout.png') })
  await page.getByTestId('mock-mollie-pay').click()
  await page.waitForURL(/\/return-to-app$/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Return to the Beebeeb app' })).toBeVisible()
  await page.waitForTimeout(1000)
  expect(new URL(page.url()).pathname).toBe('/return-to-app')
  await page.screenshot({ path: shot('real-2-return-to-app.png'), fullPage: true })
})
