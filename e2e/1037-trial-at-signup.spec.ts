/**
 * 1037 — no free signups: a trial with a payment mandate at signup.
 *
 * API-MOCKED (page.route), like 1517-trial-used-upgrade.spec.ts: the server
 * half of 1037 (`account_state`, `POST /billing/trial/checkout`, …) is built in
 * parallel and Mollie's hosted checkout cannot run in a browser test, so the
 * mocks speak the contract in SPEC-1037-trial-at-signup.md and the mocked
 * trial checkout "redirects" straight to the real return URL.
 *
 *   GATE 1 — /signup shows Starter/Basic/Pro FIRST, preselected from
 *            ?plan=&cycle=, with the honest trial terms; no free-account copy.
 *   GATE 2 — account_state "needs_plan": every app route redirects to
 *            /choose-plan (settings/account stays reachable).
 *   GATE 3 — /choose-plan: iDEAL + billing details → POST /trial/checkout with
 *            {plan, billing_cycle, method}; the pending intent carries the
 *            payment id; the return reconciles to "/" once trialing.
 *   GATE 4 — a failed mandate payment shows an inline error + retry.
 *   GATE 5 — 409 trial_already_used → normal paid checkout on billing.
 *   GATE 6 — "lapsed": persistent banner with the deletion date, CTA to billing.
 *   GATE 7 — billing: an auto-converting trial states date + amount; the
 *            legacy "Start 14-day Pro trial" CTA goes to /choose-plan and never
 *            POSTs the refused no-card /trial/start.
 *
 * Run (Vite dev server up, any VITE_API_URL — every /api/v1 call is mocked):
 *   E2E_WEB_URL=http://localhost:5173 bunx playwright test --config=e2e/1037-trial-at-signup.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'

type Json = Record<string, unknown>

const BASE_SUB: Json = {
  plan: 'free',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-09-28T00:00:00Z',
  current_period_end: null,
  has_used_trial: false,
  can_upgrade: true,
}
const NEEDS_PLAN = { ...BASE_SUB, account_state: 'needs_plan', effective_plan: 'none' }
const TRIALING = {
  ...BASE_SUB,
  plan: 'basic',
  billing_cycle: 'yearly',
  status: 'trialing',
  trial_ends_at: '2026-10-13T12:00:00Z',
  has_used_trial: true,
  account_state: 'ok',
  effective_plan: 'basic',
  trial_auto_converts: true,
}
const LAPSED = {
  ...BASE_SUB,
  plan: 'basic',
  status: 'cancelled',
  has_used_trial: true,
  account_state: 'lapsed',
  effective_plan: 'none',
  data_deletion_at: '2026-12-01T12:00:00Z',
}

const PLANS = [
  { id: 'starter', name: 'Starter', price_eur: 1.99, price_yearly_eur: 19.9, storage_bytes: 100e9, storage_label: '100 GB', per_seat: false, min_seats: 1, features: [], trial_days: 14 },
  { id: 'basic', name: 'Basic', price_eur: 3.99, price_yearly_eur: 39.9, storage_bytes: 200e9, storage_label: '200 GB', per_seat: false, min_seats: 1, features: [], trial_days: 14 },
  { id: 'pro', name: 'Pro', price_eur: 10.99, price_yearly_eur: 109.9, storage_bytes: 1e12, storage_label: '1 TB', per_seat: false, min_seats: 1, features: [], trial_days: 14 },
  { id: 'business', name: 'Teams', price_eur: 54.95, price_yearly_eur: 549.5, storage_bytes: 5e12, storage_label: '5 TB', per_seat: false, min_seats: 1, features: [], coming_soon: true, purchasable: false },
]

const AUTH_USER = {
  user_id: '00000000-0000-0000-0000-000000001037',
  email: 'trial-1037@beebeeb.dev',
  email_verified: true,
  created_at: '2026-09-28T00:00:00Z',
  role: 'user',
  totp_enabled: false,
}

const CORS = { 'access-control-allow-origin': WEB, 'access-control-allow-credentials': 'true' }

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) })
}

interface Mock {
  loggedIn: boolean
  /** Subscription served on each GET (the function sees the call count). */
  sub: (n: number) => Json
  paymentStatus: string
  checkout: { status: number; body: unknown }
  profile: Json | null
  calls: { subscription: number; trialStart: number; trialCheckout: number; paymentStatus: number; profilePut: number }
  trialCheckoutBodies: Json[]
}

async function installMocks(page: Page, partial: Partial<Mock>): Promise<Mock> {
  const m: Mock = {
    loggedIn: true,
    sub: () => NEEDS_PLAN,
    paymentStatus: 'open',
    checkout: { status: 200, body: { url: `${WEB}/choose-plan?returned=1`, payment_id: 'tr_mock1037' } },
    profile: null,
    calls: { subscription: 0, trialStart: 0, trialCheckout: 0, paymentStatus: 0, profilePut: 0 },
    trialCheckoutBodies: [],
    ...partial,
  }
  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()
    if (!url.includes('/api/v1/') && !url.includes('/dev/auto-login')) return route.fallback()
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: { ...CORS, 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,x-beebeeb-client,x-beebeeb-client-version' },
      })
    }
    if (url.includes('/dev/auto-login')) {
      if (!m.loggedIn) return json(route, { error: 'nope' }, 404)
      const b64 = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return json(route, { session_token: 'dev-mock-session', user_id: AUTH_USER.user_id, master_key_bytes_base64: b64, email: AUTH_USER.email, role: 'user' })
    }
    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return m.loggedIn ? json(route, AUTH_USER) : json(route, { error: 'unauthorized' }, 401)

    if (url.includes('/billing/subscription')) {
      m.calls.subscription += 1
      return json(route, m.sub(m.calls.subscription))
    }
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/trial/start')) {
      m.calls.trialStart += 1
      return json(route, { error: 'trial_requires_payment_method', message: 'Use /trial/checkout' }, 409)
    }
    if (url.includes('/billing/trial/checkout')) {
      m.calls.trialCheckout += 1
      m.trialCheckoutBodies.push(JSON.parse(req.postData() ?? '{}'))
      return json(route, m.checkout.body, m.checkout.status)
    }
    if (url.includes('/billing/payment/')) {
      m.calls.paymentStatus += 1
      return json(route, { payment_id: 'tr_mock1037', status: m.paymentStatus, converged: true, cached: false, checked: true })
    }
    if (url.includes('/billing/profile')) {
      if (method === 'PUT') {
        m.calls.profilePut += 1
        m.profile = { ...JSON.parse(req.postData() ?? '{}'), vat_validated: 'unchecked' }
        return json(route, m.profile)
      }
      return m.profile ? json(route, m.profile) : json(route, { error: 'not_found' }, 404)
    }
    if (url.includes('/billing/vat-preview')) {
      const cycle = new URL(url).searchParams.get('cycle')
      const net = cycle === 'yearly' ? 3298 : 330
      return json(route, { net_cents: net, vat_rate_bps: 2100, vat_cents: Math.round(net * 0.21), gross_cents: Math.round(net * 1.21), treatment: 'domestic' })
    }
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/transactions')) return json(route, { transactions: [] })
    if (url.includes('/billing/usage')) return json(route, { used_bytes: 0, quota_bytes: 0, percentage: 0 })
    if (url.includes('/billing/storage-addons')) return json(route, { extra_storage_tb: 0, base_storage_tb: 0, max_storage_tb: 0, effective_storage_bytes: 0 })
    if (url.includes('/billing/payment-method')) return json(route, { error: 'not_found' }, 404)
    if (url.includes('/storage/usage') || url.includes('/usage')) return json(route, { used_bytes: 0, plan_limit_bytes: 0, plan_name: 'none' })
    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })
    return json(route, {})
  })
  return m
}

async function boot(page: Page, path: string, init?: { planIntent?: { plan: string; cycle: string } }) {
  await page.addInitScript((intent) => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
    if (intent) localStorage.setItem('bb_plan_intent', JSON.stringify({ ...intent, ts: Date.now() }))
  }, init?.planIntent ?? null)
  await page.goto(`${WEB}${path}`)
}

test.describe('1037 — trial with a payment mandate at signup', () => {
  test('GATE 1 — /signup shows the trial plans first, preselected, honest terms, no free account', async ({ page }) => {
    await installMocks(page, { loggedIn: false })
    await boot(page, '/signup?plan=pro&cycle=yearly&nodev=1')

    const picker = page.getByTestId('trial-plan-picker')
    await expect(picker).toBeVisible({ timeout: 20_000 })
    for (const id of ['starter', 'basic', 'pro']) {
      await expect(page.getByTestId(`trial-plan-${id}`)).toBeVisible()
    }
    await expect(page.getByTestId('trial-plan-free')).toHaveCount(0)
    await expect(page.getByTestId('trial-plan-pro')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('trial-cycle-yearly')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('trial-plan-pro')).toContainText('€109.90')
    await expect(page.getByTestId('trial-terms')).toHaveText(
      '14-day free trial. Card or iDEAL needed to start. No charge until day 15; cancel any time before.',
    )
    // The plans come BEFORE the email field.
    const pickerBox = await picker.boundingBox()
    const emailBox = await page.getByLabel(/email/i).boundingBox()
    expect(pickerBox!.y).toBeLessThan(emailBox!.y)

    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/free account|5 ?GB free|free 5 ?GB|sign up free/i)

    // Changing the choice is saved as the plan intent for /choose-plan.
    await page.getByTestId('trial-cycle-monthly').click()
    await page.getByTestId('trial-plan-starter').click()
    await expect(page.getByTestId('trial-plan-starter')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('trial-plan-starter')).toContainText('€1.99')
    const intent = await page.evaluate(() => JSON.parse(localStorage.getItem('bb_plan_intent') ?? 'null'))
    expect(intent).toMatchObject({ plan: 'starter', cycle: 'monthly' })
    await page.screenshot({ path: `${SHOTS}/1037-gate1-signup-plans-first.png`, fullPage: true })
  })

  test('GATE 2 — needs_plan: every app route redirects to /choose-plan; account settings stay reachable', async ({ page }) => {
    await installMocks(page, { sub: () => NEEDS_PLAN })
    await boot(page, '/', { planIntent: { plan: 'basic', cycle: 'yearly' } })
    await page.waitForURL(/\/choose-plan/, { timeout: 30_000 })
    await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('trial-plan-basic')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('trial-cycle-yearly')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('choose-plan-logout')).toBeVisible()
    await expect(page.getByTestId('choose-plan-delete-account')).toHaveAttribute('href', '/settings/delete-account')
    await page.screenshot({ path: `${SHOTS}/1037-gate2-choose-plan.png`, fullPage: true })

    await page.goto(`${WEB}/photos`)
    await page.waitForURL(/\/choose-plan/, { timeout: 30_000 })

    // /settings/account forwards to /settings/profile (account settings, with
    // the delete-account link) — both must stay reachable.
    await page.goto(`${WEB}/settings/account`)
    await page.waitForURL(/\/settings\/profile/, { timeout: 15_000 })
    await page.waitForTimeout(1_500)
    expect(new URL(page.url()).pathname).toBe('/settings/profile')
    await page.goto(`${WEB}/settings/delete-account`)
    await page.waitForTimeout(1_500)
    expect(new URL(page.url()).pathname).toBe('/settings/delete-account')
  })

  test('GATE 3 — iDEAL + billing details → POST /trial/checkout → return reconciles to the drive', async ({ page }) => {
    // needs_plan until the "webhook" lands: only after the SECOND payment-status
    // check (i.e. one pending reconcile tick) is the subscription trialing.
    const m = await installMocks(page, { paymentStatus: 'paid' })
    m.sub = () => (m.calls.paymentStatus >= 2 ? TRIALING : NEEDS_PLAN)
    await boot(page, '/choose-plan', { planIntent: { plan: 'basic', cycle: 'yearly' } })
    await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('trial-method-ideal').click()
    await expect(page.getByTestId('choose-plan-summary')).toContainText('€0.01')
    await expect(page.getByTestId('choose-plan-summary')).toContainText('€39.90/year')
    await page.getByTestId('choose-plan-continue').click()

    // The existing billing-profile step (country / type / address + VAT preview).
    await expect(page.getByTestId('billing-info-step')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('Full name').fill('Test Trial')
    await page.getByTestId('billing-country').selectOption('NL')
    await page.getByLabel('Street and house number').fill('Hoofdstraat 1')
    await page.getByLabel('Postal code').fill('6602 AB')
    await page.getByLabel('City').fill('Wijchen')
    await expect(page.getByTestId('vat-gross')).toContainText('EUR 39.91', { timeout: 10_000 })
    await expect(page.getByTestId('vat-preview-note')).toContainText(/after your 14-day trial/)
    await page.screenshot({ path: `${SHOTS}/1037-gate3-billing-details.png`, fullPage: true })

    await page.getByRole('button', { name: 'Start 14-day free trial' }).click()
    await page.waitForURL(/\/choose-plan\?returned=1/, { timeout: 15_000 })

    expect(m.calls.profilePut).toBeGreaterThan(0)
    expect(m.calls.trialCheckout).toBe(1)
    expect(m.trialCheckoutBodies[0]).toEqual({ plan: 'basic', billing_cycle: 'yearly', method: 'ideal' })
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('bb_pending_checkout') ?? 'null'))
    // Written before the redirect; cleared once the trial is live. Either the
    // record is still there (mid-reconcile) with the payment id, or it is gone.
    if (pending) expect(pending).toMatchObject({ kind: 'trial', plan: 'basic', cycle: 'yearly', paymentId: 'tr_mock1037' })

    await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 })
    await expect(page.getByText('Your free trial has started')).toBeVisible({ timeout: 10_000 })
    expect(m.calls.paymentStatus).toBeGreaterThan(0)
    expect(m.calls.trialStart).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('bb_pending_checkout'))).toBeNull()
    await page.screenshot({ path: `${SHOTS}/1037-gate3-trial-live-drive.png`, fullPage: true })
  })

  test('GATE 4 — a failed mandate payment shows an inline error and lets the user retry', async ({ page }) => {
    await installMocks(page, { sub: () => NEEDS_PLAN, paymentStatus: 'failed' })
    await page.addInitScript(() => {
      localStorage.setItem('bb_pending_checkout', JSON.stringify({
        kind: 'trial', plan: 'pro', cycle: 'monthly', ts: Date.now(), paymentId: 'tr_mock1037',
        pre: { plan: 'free', status: 'active', extraStorageTb: 0, storageTbQuantity: 0 },
      }))
    })
    await boot(page, '/choose-plan?returned=1')
    const failed = page.getByTestId('choose-plan-failed')
    await expect(failed).toBeVisible({ timeout: 30_000 })
    await expect(failed).toContainText(/trial has not started/i)
    await page.screenshot({ path: `${SHOTS}/1037-gate4-payment-failed.png`, fullPage: true })
    await failed.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByTestId('choose-plan')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('returned')).toBeNull()
  })

  test('GATE 5 — 409 trial_already_used goes to normal paid checkout', async ({ page }) => {
    const m = await installMocks(page, {
      sub: () => NEEDS_PLAN,
      profile: { full_name: 'T', billing_country: 'NL', billing_street: 'S 1', billing_postal: '1', billing_city: 'C', customer_type: 'b2c', vat_validated: 'unchecked' },
      checkout: { status: 409, body: { error: 'trial_already_used', message: 'You have already used your free trial on this account.' } },
    })
    await boot(page, '/choose-plan')
    await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('choose-plan-continue').click()
    await expect(page.getByTestId('billing-info-step')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Start 14-day free trial' }).click()
    await page.waitForURL(/\/settings\/billing\?view=change/, { timeout: 15_000 })
    await expect(page.getByText(/already used your free trial/i)).toBeVisible()
    expect(m.calls.trialCheckout).toBe(1)
  })

  test('GATE 6 — lapsed: persistent read-only banner with the deletion date; CTA to paid checkout', async ({ page }) => {
    await installMocks(page, { sub: () => LAPSED })
    await boot(page, '/')
    const banner = page.getByTestId('lapsed-banner')
    await expect(banner).toBeVisible({ timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(banner).toContainText(
      'Your trial has ended and your vault is read-only. Your files will be permanently deleted on 1 December 2026. Subscribe to keep them.',
    )
    await expect(banner.getByRole('button', { name: /dismiss|close/i })).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/1037-gate6-lapsed-banner.png`, fullPage: true })
    await banner.getByRole('button', { name: 'Subscribe' }).click()
    await page.waitForURL(/\/settings\/billing\?view=change/, { timeout: 15_000 })
    await expect(page.getByTestId('billing-lapsed')).toBeVisible({ timeout: 15_000 })
  })

  test('GATE 7 — billing: auto-converting trial copy; legacy trial CTA → /choose-plan, never /trial/start', async ({ page }) => {
    await installMocks(page, { sub: () => TRIALING })
    await boot(page, '/settings/billing')
    const panel = page.getByTestId('billing-trial-auto')
    await expect(panel).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('billing-trial-auto-copy')).toContainText(
      'Trial — ends 13 Oct 2026. Then €39.90/year, charged automatically.',
    )
    await expect(page.getByRole('button', { name: /Add payment method/i })).toHaveCount(0)
    await expect(page.getByTestId('billing-trial-cancel')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/1037-gate7-billing-auto-trial.png`, fullPage: true })
  })

  test('GATE 7b — a grandfathered Free account\'s "Start 14-day Pro trial" goes through /choose-plan', async ({ page }) => {
    const m = await installMocks(page, { sub: () => ({ ...BASE_SUB, account_state: 'ok' }) })
    await boot(page, '/settings/billing?view=change')
    await page.getByRole('button', { name: /Start 14-day Pro trial/i }).click()
    await page.waitForURL(/\/choose-plan\?plan=pro&cycle=monthly&from=billing/, { timeout: 15_000 })
    await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('trial-plan-pro')).toHaveAttribute('aria-checked', 'true')
    expect(m.calls.trialStart).toBe(0)
  })
})
