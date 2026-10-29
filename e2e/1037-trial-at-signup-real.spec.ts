/**
 * 1037 — no free signups: the WHOLE trial-with-mandate flow on the REAL stack.
 *
 * No page.route mocks. The debug server's built-in mock Mollie
 * (`/dev/mock-mollie`, debug builds only) stands in for Mollie: its hosted
 * checkout page has Pay / Fail links that set the payment status, deliver the
 * webhook, then 303 to the payment's redirectUrl (`/choose-plan?returned=1`).
 *
 * Run (needs a server with 1037; the gate ON; Mollie pointed at the mock):
 *   BB_REQUIRE_PLAN_AT_SIGNUP=1 MOLLIE_API_KEY=test_mock_local \
 *   MOLLIE_API_BASE=http://localhost:$E2E_API_PORT/dev/mock-mollie/v2 \
 *   E2E_API_BIN=… E2E_API_PORT=… E2E_VITE_PORT=… E2E_DB_NAME=… \
 *     ./e2e/scripts/web-e2e.sh e2e/1037-trial-at-signup-real.spec.ts
 * Skipped (not failed) without those — the default suite runs the debug
 * server with the gate off and no Mollie.
 *
 *   PAID   — /signup with a plan picked → /choose-plan (needs_plan) → iDEAL →
 *            billing profile → mock checkout → Pay → /choose-plan?returned=1 →
 *            trialing → the drive, WITH the deferred welcome file → billing
 *            says "Trial — ends … charged automatically". Then the account is
 *            lapsed by SQL (what lapse_row does) → persistent lapsed banner,
 *            uploads blocked with the read-only notice, CTA to paid checkout.
 *   FAILED — same up to the mock checkout → Fail → inline error + Try again.
 */
import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'
import { reachPasswordStep, createAccount, uniqueEmail } from './helpers/signup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'
const PG_URL = `postgres://beebeeb:beebeeb_dev@localhost:${process.env.E2E_PG_PORT ?? '5434'}/${process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'}`

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(240_000)
test.skip(
  process.env.BB_REQUIRE_PLAN_AT_SIGNUP !== '1' || !process.env.MOLLIE_API_BASE,
  'needs BB_REQUIRE_PLAN_AT_SIGNUP=1 + MOLLIE_API_BASE → the debug mock Mollie',
)

async function subscription(page: Page) {
  const res = await page.request.get(`${API_URL}/api/v1/billing/subscription`)
  expect(res.ok(), `GET /billing/subscription: ${res.status()}`).toBe(true)
  return res.json()
}

/** /signup with Basic + Yearly picked in the UI → onboarding → /choose-plan. */
async function signUpWithPlan(page: Page, email: string, shot?: string) {
  // Cookie choice made up front so the banner doesn't cover the evidence shots.
  await page.addInitScript(() => localStorage.setItem('bb_cookie_consent', 'all'))
  await page.goto('/signup?nodev=1')
  await expect(page.getByTestId('trial-plan-picker')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('trial-cycle-yearly').click()
  await page.getByTestId('trial-plan-basic').click()
  await expect(page.getByTestId('trial-plan-basic')).toHaveAttribute('aria-checked', 'true')
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
  if (shot) await page.screenshot({ path: shot, fullPage: true })
  await page.getByRole('button', { name: /^continue$/i }).click()
  await reachPasswordStep(page)
  await createAccount(page, 'trial-1037-correct-horse-battery')
  await page.waitForURL(/\/choose-plan/, { timeout: 60_000 })
  await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
}

/** Method → billing profile → POST /trial/checkout → the mock hosted checkout. */
async function startTrialCheckout(page: Page, method: 'ideal' | 'creditcard') {
  await page.getByTestId(`trial-method-${method}`).click()
  await page.getByTestId('choose-plan-continue').click()
  await expect(page.getByTestId('billing-info-step')).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Full name').fill('Trial Tester')
  await page.getByTestId('billing-country').selectOption('NL')
  await page.getByLabel('Street and house number').fill('Hoofdstraat 1')
  await page.getByLabel('Postal code').fill('6602 AB')
  await page.getByLabel('City').fill('Wijchen')
  await expect(page.getByTestId('vat-gross')).not.toHaveText('…', { timeout: 10_000 })
  const checkout = page.waitForResponse(
    (r) => r.url().includes('/api/v1/billing/trial/checkout') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Start 14-day free trial/ }).click()
  const res = await checkout
  // The browser leaves for the checkout at once, so the body may be gone —
  // only read it when it explains a failure.
  if (res.status() !== 200) throw new Error(`POST /billing/trial/checkout ${res.status()}: ${await res.text().catch(() => '')}`)
  expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ plan: 'basic', billing_cycle: 'yearly', method })
  await page.waitForURL(/\/dev\/mock-mollie\/checkout\//, { timeout: 15_000 })
  await expect(page.getByTestId('mock-mollie-checkout')).toBeVisible()
}

test('PAID — signup → /choose-plan → iDEAL mandate → trialing drive with welcome file → billing → lapsed', async ({ page }) => {
  const email = uniqueEmail('trial-1037-paid')
  await signUpWithPlan(page, email, `${SHOTS}/1037-real-01-signup.png`)

  // needs_plan: the server says so, and every app route comes back here.
  expect((await subscription(page)).account_state).toBe('needs_plan')
  await expect(page.getByTestId('trial-plan-basic')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('trial-cycle-yearly')).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: `${SHOTS}/1037-real-02-choose-plan.png`, fullPage: true })
  await page.goto('/')
  await page.waitForURL(/\/choose-plan/, { timeout: 30_000 })
  await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })

  await startTrialCheckout(page, 'ideal')
  await page.screenshot({ path: `${SHOTS}/1037-real-03-mock-checkout.png`, fullPage: true })
  await page.getByTestId('mock-mollie-pay').click()

  // Back on the chooser (?returned=1) → reconciled → the drive.
  await page.waitForURL(/\/choose-plan\?returned=1/, { timeout: 30_000 })
  await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 })
  await expect(page.getByText('Your free trial has started')).toBeVisible({ timeout: 15_000 })

  const sub = await subscription(page)
  expect(sub).toMatchObject({ plan: 'basic', billing_cycle: 'yearly', status: 'trialing', account_state: 'ok', trial_auto_converts: true })
  expect(sub.trial_ends_at).toBeTruthy()

  // The welcome file onboarding deferred is uploaded once the trial is live.
  await expect(page.getByText('Welcome to Beebeeb.md').first()).toBeVisible({ timeout: 30_000 })
  const pref = await (await page.request.get(`${API_URL}/api/v1/preferences/welcome_file`)).json()
  expect(pref.value).toBe('done')
  await page.screenshot({ path: `${SHOTS}/1037-real-04-trial-drive-welcome.png`, fullPage: true })

  // Billing: the auto-converting trial line.
  await page.goto('/settings/billing')
  await expect(page.getByTestId('billing-trial-auto-copy')).toContainText(
    /^Trial — ends \d{1,2} \w{3} \d{4}\. Then €39\.90\/year, charged automatically\./,
    { timeout: 30_000 },
  )
  await page.screenshot({ path: `${SHOTS}/1037-real-05-billing-trial.png`, fullPage: true })

  // Lapse it the way the server's lapse_row does (trial ended unpaid).
  execFileSync('psql', [PG_URL, '-v', 'ON_ERROR_STOP=1', '-c',
    `UPDATE users SET plan_required = TRUE, has_used_trial = TRUE WHERE email = '${email}';
     UPDATE subscriptions SET status = 'cancelled', plan = 'none', trial_ends_at = NULL,
       storage_grace_deadline = NOW() + INTERVAL '60 days', cancel_wipe_due_at = NULL
     WHERE user_id = (SELECT id FROM users WHERE email = '${email}');`])
  expect((await subscription(page)).account_state).toBe('lapsed')

  await page.goto('/')
  const banner = page.getByTestId('lapsed-banner')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe('/') // read-only, not locked out
  await expect(banner).toContainText(
    /^Your trial has ended and your vault is read-only\. Your files will be permanently deleted on \d{1,2} \w+ \d{4}\. Subscribe to keep them\./,
  )
  await expect(page.getByText('Welcome to Beebeeb.md').first()).toBeVisible({ timeout: 30_000 })
  // The first-visit welcome tour may open on the drive; it is not under test.
  const skipTour = page.getByRole('button', { name: /skip tour/i }).first()
  await skipTour.waitFor({ state: 'visible', timeout: 5_000 }).then(() => skipTour.click()).catch(() => {})
  const skipGuide = page.getByRole('button', { name: /skip for now/i }).first()
  await skipGuide.waitFor({ state: 'visible', timeout: 5_000 }).then(() => skipGuide.click()).catch(() => {})
  // Uploads: a clear read-only notice, not "Not enough storage".
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'lapsed.txt', mimeType: 'text/plain', buffer: Buffer.from('nope'),
  })
  await expect(page.getByText('Your vault is read-only', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Not enough storage')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/1037-real-06-lapsed-banner.png`, fullPage: true })
  // The notice auto-dismisses; it must not pin itself over the banner CTA.
  await expect(page.getByText('Your vault is read-only', { exact: true })).toHaveCount(0, { timeout: 15_000 })
  await banner.getByRole('button', { name: 'Subscribe' }).click()
  await page.waitForURL(/\/settings\/billing\?view=change/, { timeout: 15_000 })
  await expect(page.getByTestId('billing-lapsed')).toBeVisible({ timeout: 15_000 })
})

test('FAILED — a failed mandate payment shows the inline error and lets the user retry', async ({ page }) => {
  const email = uniqueEmail('trial-1037-failed')
  await signUpWithPlan(page, email)
  await startTrialCheckout(page, 'creditcard')
  await page.getByTestId('mock-mollie-fail').click()

  await page.waitForURL(/\/choose-plan\?returned=1/, { timeout: 30_000 })
  const failed = page.getByTestId('choose-plan-failed')
  await expect(failed).toBeVisible({ timeout: 60_000 })
  await expect(failed).toContainText(/trial has not started/i)
  expect((await subscription(page)).account_state).toBe('needs_plan')
  await page.screenshot({ path: `${SHOTS}/1037-real-07-payment-failed.png`, fullPage: true })

  await failed.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByTestId('choose-plan')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('returned')).toBeNull()
  await page.screenshot({ path: `${SHOTS}/1037-real-08-retry.png`, fullPage: true })
})
