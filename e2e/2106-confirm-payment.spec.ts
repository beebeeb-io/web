/**
 * 2106 — "your bank asks you to confirm your first payment" (server 2092b, client side),
 * on the REAL stack: no page.route mocks. The debug server's built-in mock Mollie
 * (`/dev/mock-mollie`) stands in for Mollie.
 *
 * STATE SETUP. A real mandated trial is created through the UI (signup -> iDEAL mandate ->
 * mock checkout -> trialing, with a Mollie subscription). The debug mock Mollie cannot
 * produce a `authentication_required` trial-end charge failure (the server's own tests
 * deliver that webhook against wiremock), so the HOLD is seeded in the harness DB exactly
 * as `hold_trial_for_bank_confirmation` leaves it: `trial_ends_at` and `current_period_end`
 * moved to the end of the hold, plus the not-done `trial_confirm_payment_lapse` billing job
 * whose idempotency key `trial-confirm-payment-lapse-<subscription id>` is what makes
 * `GET /billing/subscription` answer `confirm_payment_by`. Nothing else is faked.
 *
 * Run (server at 03f16203 or later; plan gate ON; Mollie -> the mock):
 *   BB_REQUIRE_PLAN_AT_SIGNUP=1 MOLLIE_API_KEY=test_mock_local \
 *   MOLLIE_API_BASE=http://localhost:$E2E_API_PORT/dev/mock-mollie/v2 \
 *   E2E_API_BIN=<server>/target/debug/beebeeb-api \
 *     ./e2e/scripts/web-e2e.sh e2e/2106-confirm-payment.spec.ts
 * Screenshots: e2e/screenshots/2106/ (override with E2E_EVIDENCE_DIR).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { reachPasswordStep, createAccount, uniqueEmail } from './helpers/signup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots/2106'
const DB_NAME = process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'
const PG_PORT = process.env.E2E_PG_PORT ?? '5434'
const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'beebeebio-postgres-1'

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(300_000)
test.skip(
  process.env.BB_REQUIRE_PLAN_AT_SIGNUP !== '1' || !process.env.MOLLIE_API_BASE,
  'needs BB_REQUIRE_PLAN_AT_SIGNUP=1 + MOLLIE_API_BASE -> the debug mock Mollie',
)

async function subscription(page: Page) {
  const res = await page.request.get(`${API_URL}/api/v1/billing/subscription`)
  expect(res.ok(), `GET /billing/subscription: ${res.status()}`).toBe(true)
  return res.json()
}

/** Host psql when present (same as web-e2e.sh), else `docker exec` into the dev Postgres. */
function sql(q: string) {
  const env = { ...process.env, PGPASSWORD: 'beebeeb_dev' }
  try {
    execFileSync('psql', ['-h', 'localhost', '-p', PG_PORT, '-U', 'beebeeb', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-c', q], { env })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    execFileSync('docker', ['exec', '-e', 'PGPASSWORD=beebeeb_dev', PG_CONTAINER, 'psql', '-U', 'beebeeb', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-c', q], { env })
  }
}

async function dismissOverlays(page: Page) {
  for (const name of [/skip tour/i, /skip for now/i]) {
    const b = page.getByRole('button', { name }).first()
    await b.waitFor({ state: 'visible', timeout: 3_000 }).then(() => b.click()).catch(() => {})
  }
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

/** signup -> /choose-plan -> iDEAL mandate -> mock checkout Pay -> trialing. */
async function startMandatedTrial(page: Page, email: string) {
  await page.addInitScript(() => localStorage.setItem('bb_cookie_consent', 'all'))
  await page.goto('/signup?nodev=1')
  await expect(page.getByTestId('trial-plan-picker')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('trial-cycle-yearly').click()
  await page.getByTestId('trial-plan-basic').click()
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  await page.getByRole('button', { name: /^continue$/i }).click()
  await reachPasswordStep(page)
  await createAccount(page, 'trial-2106-correct-horse-battery')
  await page.waitForURL(/\/choose-plan/, { timeout: 60_000 })
  await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('trial-method-ideal').click()
  await page.getByTestId('choose-plan-continue').click()
  await expect(page.getByTestId('billing-info-step')).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Full name').fill('Trial Tester')
  await page.getByTestId('billing-country').selectOption('NL')
  await page.getByLabel('Street and house number').fill('Hoofdstraat 1')
  await page.getByLabel('Postal code').fill('6602 AB')
  await page.getByLabel('City').fill('Wijchen')
  await expect(page.getByTestId('vat-gross')).not.toHaveText('…', { timeout: 10_000 })
  await page.getByRole('button', { name: /Start 14-day free trial/ }).click()
  await page.waitForURL(/\/dev\/mock-mollie\/checkout\//, { timeout: 15_000 })
  await page.getByTestId('mock-mollie-pay').click()
  await page.waitForURL(/\/choose-plan\?returned=1/, { timeout: 30_000 })
  await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 })
  await expect.poll(async () => (await subscription(page)).status, { timeout: 30_000 }).toBe('trialing')
}

test('normal trial keeps today\'s copy; a held trial shows the confirm banner; ?confirm_payment=trial pays now', async ({ page }) => {
  const email = uniqueEmail('trial-2106')
  await startMandatedTrial(page, email)

  // ── 1. A normal mandated trial: today's copy, no confirm copy anywhere. ──
  let sub = await subscription(page)
  expect(sub).toMatchObject({ status: 'trialing', trial_auto_converts: true })
  expect(sub.confirm_payment_by ?? null).toBeNull()
  await page.goto('/settings/billing')
  await expect(page.getByTestId('billing-trial-auto-copy')).toContainText(/charged automatically/, { timeout: 30_000 })
  await expect(page.getByTestId('billing-trial-confirm')).toHaveCount(0)
  await expect(page.getByText(/confirm your first payment/i)).toHaveCount(0)
  await page.goto('/')
  await dismissOverlays(page)
  await expect(page.getByTestId('trial-banner-auto')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('trial-banner-confirm')).toHaveCount(0)

  // ── 2. Seed the hold exactly as the server leaves it after a 3-D Secure trial-end decline. ──
  sql(`WITH s AS (SELECT id FROM subscriptions WHERE user_id = (SELECT id FROM users WHERE email = '${email}') ORDER BY created_at DESC LIMIT 1),
            u AS (UPDATE subscriptions SET trial_ends_at = NOW() + INTERVAL '3 days', current_period_end = NOW() + INTERVAL '3 days'
                  WHERE id = (SELECT id FROM s))
       INSERT INTO billing_jobs (job_type, idempotency_key, payload, max_attempts, next_run_at)
       SELECT 'trial_confirm_payment_lapse', 'trial-confirm-payment-lapse-' || s.id::text, '{}'::jsonb, 5, NOW() + INTERVAL '3 days' FROM s;`)
  sub = await subscription(page)
  expect(sub.status).toBe('trialing')
  expect(sub.trial_auto_converts).toBe(true) // the hold does NOT change it (server review P1-1)
  expect(typeof sub.confirm_payment_by).toBe('string')

  // ── 3. The held trial: the confirm banner, never "charged automatically". ──
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/settings/billing')
  const card = page.getByTestId('billing-trial-confirm')
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('billing-trial-confirm-copy')).toContainText(
    /^Your bank asks you to confirm your first payment\. Confirm by .+, or your trial ends then\.$/,
  )
  await expect(page.getByTestId('billing-trial-auto')).toHaveCount(0)
  await expect(page.getByText(/charged automatically/i)).toHaveCount(0)
  await expect(page.getByTestId('billing-trial-confirm-cta')).toBeEnabled()
  await shot(page, '2106-held-billing-1440')
  // Narrow: load fresh at 390 (resizing a loaded page leaves the mobile nav drawer open over the card).
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings/billing')
  await dismissOverlays(page)
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.scrollIntoViewIfNeeded()
  await shot(page, '2106-held-billing-390')
  // The app shell's trial banner follows the same rule.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await dismissOverlays(page)
  const shell = page.getByTestId('trial-banner-confirm')
  await expect(shell).toBeVisible({ timeout: 30_000 })
  await expect(shell).toContainText('confirm your first payment')
  await expect(page.getByTestId('trial-banner-auto')).toHaveCount(0)
  await shot(page, '2106-held-shell-1440')

  // ── 4. The held-trial mail's link: ?confirm_payment=trial starts pay-now. ──
  const payNow = page.waitForResponse((r) => r.url().includes('/api/v1/billing/trial/pay-now') && r.request().method() === 'POST')
  await page.goto('/billing?confirm_payment=trial') // the mail's path; redirects to /settings/billing
  const res = await payNow
  expect(res.status()).toBe(200)
  // The browser leaves for the checkout at once, so the body is gone: the redirect proves checkout_url.
  await page.waitForURL(/\/dev\/mock-mollie\/checkout\//, { timeout: 15_000 })
  await page.getByTestId('mock-mollie-pay').click()
  // Back on billing with the poll result shown, and the param gone.
  await expect(page.getByTestId('pay-now-return')).toHaveAttribute('data-kind', 'paid', { timeout: 60_000 })
  await expect(page.getByTestId('pay-now-return')).toContainText('Payment received — your plan is active.')
  expect(new URL(page.url()).searchParams.get('confirm_payment')).toBeNull()
  expect(new URL(page.url()).searchParams.get('trial_pay_now')).toBeNull()
  await expect(page.getByTestId('billing-trial-confirm')).toHaveCount(0)
  await shot(page, '2106-pay-now-returned-1440')
  expect((await subscription(page)).status).toBe('active')
})
