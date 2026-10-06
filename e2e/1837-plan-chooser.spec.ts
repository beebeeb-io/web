/**
 * 1837 — the plan chooser after web signup (Guus, 2026-10-06): the card / iDEAL trial is
 * the primary action with the plan chosen up front; "Continue without card" is secondary,
 * only while the document offers it; no sentence promises an allowance that is not there.
 *
 * API-MOCKED (page.route). The onboarding document is the vendored needs_plan fixture,
 * edited to the case under test, so the page reads exactly what the server's contract says.
 *
 *   CASE 1 — no plan, both trials open: card primary (amber), "Continue without card"
 *            secondary (not amber), no "cannot show yet" banner, no allowance copy.
 *            The card path leads to billing details; the no-card path posts the chosen plan.
 *   CASE 2 — only the card trial (the no-card one is "not right now"): no secondary button.
 *   CASE 3 — only the no-card trial (BB_MANDATED_TRIAL_ENABLED unset, D18): it is primary.
 *   CASE 4 — no trial can start (already used): the reason, "Subscribe now", no start button.
 *   CASE 5 — no trial offer in the document: the card flow, as before.
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:37971'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'
const FIXTURE = join(__dirname, '..', 'src', 'contracts', 'onboarding', 'fixtures', 'account.needs_plan.web.coupon.json')

type Json = Record<string, any>

const NEEDS_PLAN_SUB: Json = {
  plan: 'free',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-10-06T00:00:00Z',
  current_period_end: null,
  has_used_trial: false,
  can_upgrade: true,
  account_state: 'needs_plan',
  effective_plan: 'none',
}

const PLANS = [
  { id: 'starter', name: 'Starter', price_eur: 1.99, price_yearly_eur: 19.9, storage_bytes: 100e9, storage_label: '100 GB', per_seat: false, min_seats: 1, features: [], trial_days: 14 },
  { id: 'basic', name: 'Basic', price_eur: 3.99, price_yearly_eur: 39.9, storage_bytes: 200e9, storage_label: '200 GB', per_seat: false, min_seats: 1, features: [], trial_days: 14 },
  { id: 'pro', name: 'Pro', price_eur: 10.99, price_yearly_eur: 109.9, storage_bytes: 1e12, storage_label: '1 TB', per_seat: false, min_seats: 1, features: [], trial_days: 14 },
]

const AUTH_USER = {
  user_id: '00000000-0000-0000-0000-000000001837',
  email: 'chooser-1837@beebeeb.io',
  email_verified: true,
  created_at: '2026-10-06T00:00:00Z',
  role: 'user',
  totp_enabled: false,
}

const CORS = { 'access-control-allow-origin': WEB, 'access-control-allow-credentials': 'true' }
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) })

const CARD = { length_days: 14, methods: ['creditcard', 'ideal'], checkout_endpoint: '/api/v1/billing/trial/checkout' }

interface Scenario {
  /** `true` available, a string = the unavailable reason, `null` no `offers.trial` at all. */
  noCard: true | string | null
  card: boolean
}

function documentFor(sc: Scenario): Json {
  const d = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Json
  delete d.offers.coupon
  d.steps = d.steps.filter((s: Json) => s.id !== 'redeem_coupon')
  if (sc.card) d.steps.find((s: Json) => s.id === 'choose_plan').params = { card_trial: CARD }
  if (sc.noCard !== null) {
    d.offers.trial = {
      available: sc.noCard === true,
      unavailable_reason: sc.noCard === true ? null : sc.noCard,
      length_days: 14,
      cap_bytes: 10_000_000_000,
      start_endpoint: '/api/v1/billing/trial/start',
    }
    if (sc.noCard === true) {
      d.steps.push({ id: 'start_trial', status: 'todo', required: false, ui: 'action', params: { length_days: 14, cap_bytes: 10_000_000_000, no_card: true } })
    }
  } else {
    delete d.offers
  }
  return d
}

async function installMocks(page: Page, sc: Scenario) {
  const calls = { trialStart: [] as Json[], trialCheckout: 0, subscription: 0 }
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
      const b64 = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return json(route, { session_token: 'dev-mock-session', user_id: AUTH_USER.user_id, master_key_bytes_base64: b64, email: AUTH_USER.email, role: 'user' })
    }
    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)
    if (url.includes('/api/v1/onboarding')) return json(route, documentFor(sc))
    if (url.includes('/billing/subscription')) {
      calls.subscription += 1
      return json(route, NEEDS_PLAN_SUB)
    }
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/trial/start')) {
      calls.trialStart.push(JSON.parse(req.postData() ?? '{}'))
      return json(route, { error: 'trial_temporarily_unavailable', message: 'mock: stop here' }, 409)
    }
    if (url.includes('/billing/trial/checkout')) {
      calls.trialCheckout += 1
      return json(route, { error: 'mock' }, 500)
    }
    if (url.includes('/billing/profile')) return json(route, { error: 'not_found' }, 404)
    if (url.includes('/billing/vat-preview')) return json(route, { net_cents: 330, vat_rate_bps: 2100, vat_cents: 69, gross_cents: 399, treatment: 'domestic' })
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/transactions')) return json(route, { transactions: [] })
    if (url.includes('/billing/usage')) return json(route, { used_bytes: 0, quota_bytes: 0, percentage: 0 })
    if (url.includes('/billing/storage-addons')) return json(route, { extra_storage_tb: 0, base_storage_tb: 0, max_storage_tb: 0, effective_storage_bytes: 0 })
    if (url.includes('/billing/payment-method')) return json(route, { error: 'not_found' }, 404)
    if (url.includes('/usage')) return json(route, { used_bytes: 0, plan_limit_bytes: 0, plan_name: 'none' })
    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })
    return json(route, {})
  })
  return calls
}

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
    localStorage.setItem('bb_plan_intent', JSON.stringify({ plan: 'basic', cycle: 'monthly', ts: Date.now() }))
  })
  await page.goto(`${WEB}/choose-plan`)
}

async function bothThemes(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SHOTS}/1837-${name}-${scheme}.png`, fullPage: true })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

const AMBER_BG = /(^|\s)bg-amber(\s|$)/ // the primary action only; amber-bg / amber-deep are not it

async function noAllowanceCopy(page: Page) {
  const body = (await page.locator('body').innerText()).toLowerCase()
  expect(body).not.toMatch(/allowance|your 2 gb|0 b stays|stays\./)
  expect(body).not.toContain('cannot show yet')
}

test.describe('1837 — plan chooser: card trial first, continue without card second', () => {
  test('CASE 1 — both trials open', async ({ page }) => {
    const calls = await installMocks(page, { noCard: true, card: true })
    await boot(page)
    await expect(page.getByTestId('choose-plan-chooser')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('unsupported-step-banner')).toHaveCount(0)

    // Plan up front (the stored intent preselects Basic monthly); change it.
    await expect(page.getByTestId('trial-plan-basic')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('trial-plan-pro').click()
    await page.getByTestId('trial-cycle-yearly').click()

    const card = page.getByTestId('choose-plan-continue')
    await expect(card).toHaveText(/Start 14-day trial/)
    await expect(card).toHaveClass(AMBER_BG)
    const noCard = page.getByTestId('start-trial')
    await expect(noCard).toHaveText('Continue without card')
    await expect(noCard).not.toHaveClass(AMBER_BG)
    // Primary first, secondary below it.
    const [cb, nb] = [await card.boundingBox(), await noCard.boundingBox()]
    expect(cb!.y).toBeLessThan(nb!.y)

    await expect(page.getByTestId('trial-method-ideal')).toBeVisible()
    await expect(page.getByTestId('card-trial-terms')).toContainText('Nothing is charged today')
    await expect(page.getByTestId('trial-terms')).toContainText('files become read-only and are deleted 14 days after it ends')
    await expect(page.getByTestId('choose-plan-subscribe-now')).toBeVisible()
    await noAllowanceCopy(page)
    await bothThemes(page, 'both-open')

    // Secondary: posts the plan chosen above to the document's start endpoint.
    await noCard.click()
    await expect.poll(() => calls.trialStart.length).toBe(1)
    expect(calls.trialStart[0]).toMatchObject({ plan: 'pro', billing_cycle: 'yearly' })
    await expect(page.getByTestId('trial-start-error')).toContainText('We are not starting new trials right now. You can still subscribe to a plan.')
    expect(calls.trialCheckout).toBe(0)

    // Primary: the card / iDEAL path goes on to billing details with the same plan.
    await card.click()
    await expect(page.getByText('Billing details', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('choose-plan-billing-summary')).toContainText('Pro')
  })

  test('CASE 2 — only the card trial (no-card trial not available right now)', async ({ page }) => {
    await installMocks(page, { noCard: 'temporarily_unavailable', card: true })
    await boot(page)
    await expect(page.getByTestId('choose-plan-chooser')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('choose-plan-continue')).toHaveText(/Start 14-day trial/)
    await expect(page.getByTestId('choose-plan-continue')).toHaveClass(AMBER_BG)
    await expect(page.getByTestId('start-trial')).toHaveCount(0)
    await expect(page.getByTestId('no-card-unavailable-quiet')).toHaveText('Trials without a card are not available right now.')
    await noAllowanceCopy(page)
    await bothThemes(page, 'card-only')
  })

  test('CASE 3 — only the no-card trial: it is the primary action', async ({ page }) => {
    await installMocks(page, { noCard: true, card: false })
    await boot(page)
    await expect(page.getByTestId('choose-plan-chooser')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('choose-plan-continue')).toHaveCount(0)
    const start = page.getByTestId('start-trial')
    await expect(start).toHaveText('Start 14-day trial, no card')
    await expect(start).toHaveClass(AMBER_BG)
    await expect(page.getByTestId('trial-method-picker')).toHaveCount(0)
    await noAllowanceCopy(page)
    await bothThemes(page, 'no-card-only')
  })

  test('CASE 4 — no trial can start: the reason and "Subscribe now", nothing to start', async ({ page }) => {
    await installMocks(page, { noCard: 'already_used', card: false })
    await boot(page)
    await expect(page.getByTestId('trial-unavailable')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('trial-unavailable')).toContainText('You have already had your trial.')
    await expect(page.getByTestId('choose-plan-subscribe-now')).toBeVisible()
    await expect(page.getByTestId('start-trial')).toHaveCount(0)
    await expect(page.getByTestId('choose-plan-continue')).toHaveCount(0)
    await noAllowanceCopy(page)
    await bothThemes(page, 'unavailable')
  })

  test('CASE 5 — no trial offer in the document: the card flow, as before', async ({ page }) => {
    await installMocks(page, { noCard: null, card: false })
    await boot(page)
    await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('choose-plan-continue')).toHaveText(/Continue/)
    await expect(page.getByTestId('start-trial')).toHaveCount(0)
    await bothThemes(page, 'legacy-card-flow')
  })
})
