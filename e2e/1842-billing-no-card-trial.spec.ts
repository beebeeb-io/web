/**
 * 1842 — a no-card trial must not read as an active monthly Pro subscription on the billing
 * pages. No server: every API call is mocked (pattern of e2e/1832-chooser-allowance-label.spec.ts).
 *
 * Run: E2E_WEB_URL=http://localhost:<own port> E2E_SHOTS_DIR=<dir> \
 *      bunx playwright test --config=e2e/1842-billing-no-card-trial.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'e2e/screenshots'

const NO_CARD_FIXTURE = JSON.parse(
  readFileSync('src/contracts/onboarding/fixtures/account.trialing_no_card.desktop.json', 'utf8'),
)

const DAY = 86_400_000
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString()

/** Guus's prod account: no allowance, 440 B used of the 10 GB trial cap. */
function noCardDoc() {
  const doc = JSON.parse(JSON.stringify(NO_CARD_FIXTURE))
  doc.account.storage = { quota_bytes: 10_000_000_000, used_bytes: 440, allowance_bytes: null, over_allowance: false }
  doc.account.trial.started_at = inDays(-1)
  doc.account.trial.ends_at = inDays(14)
  doc.copy = {}
  return doc
}

const BASE_SUB = {
  plan: 'pro',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  billing_state: 'active',
  created_at: '2026-01-01T00:00:00Z',
  pending_downgrade_plan: null,
  has_used_trial: true,
  can_upgrade: true,
}

// What the server returns for a no-card trial (Guus prod screenshot): a Pro row in `trialing`, no mandate.
const NO_CARD_SUB = {
  ...BASE_SUB,
  status: 'trialing',
  trial_auto_converts: false,
  trial_ends_at: inDays(14),
  current_period_end: inDays(14),
}
// A card trial: a real Mollie subscription in trialing, billed from the trial end.
const CARD_TRIAL_SUB = {
  ...BASE_SUB,
  status: 'trialing',
  trial_auto_converts: true,
  trial_ends_at: inDays(14),
  current_period_end: inDays(14),
  mandate_method: 'creditcard',
}
const PAID_SUB = { ...BASE_SUB, status: 'active', current_period_end: inDays(20) }

const PLANS = [
  { id: 'basic', name: 'Basic', price_eur: 4.99, price_yearly_eur: 49, storage_bytes: 200_000_000_000, storage_label: '200 GB', per_seat: false, min_seats: 1, features: ['200 GB'], is_active: true, sort_order: 1 },
  { id: 'pro', name: 'Pro', price_eur: 10.99, price_yearly_eur: 109.9, storage_bytes: 1_000_000_000_000, storage_label: '1 TB', per_seat: false, min_seats: 1, features: ['1 TB'], is_active: true, sort_order: 2 },
]

const AUTH_USER = {
  user_id: '00000000-0000-0000-0000-000000000001',
  email: 'dev@beebeeb.dev',
  email_verified: true,
  created_at: '2026-01-01T00:00:00Z',
  role: 'user',
  totp_enabled: false,
}

const CORS = { 'access-control-allow-origin': WEB, 'access-control-allow-credentials': 'true' }

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) })
}

function installMocks(page: Page, sub: unknown, doc: unknown = null, usedBytes = 440) {
  return page.route('**/*', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    const isApi = url.includes('/api/v1/') || url.includes('/dev/auto-login')
    if (!isApi) return route.fallback()
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: { ...CORS, 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,authorization' },
      })
    }
    if (url.includes('/dev/auto-login')) {
      const bytes = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
      const b64 = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return json(route, { session_token: 'dev-mock-session', user_id: AUTH_USER.user_id, master_key_bytes_base64: b64, email: 'dev@beebeeb.dev', role: 'user' })
    }
    if (url.includes('/api/v1/onboarding')) return doc ? json(route, doc) : json(route, {}, 404)
    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)
    if (url.includes('/billing/subscription')) return json(route, sub)
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/transactions')) return json(route, { transactions: [] })
    if (url.includes('/billing/usage')) return json(route, { used_bytes: usedBytes, file_count: 1 })
    if (url.includes('/billing/storage-addons')) {
      return json(route, { extra_storage_tb: 0, base_storage_tb: 1, max_storage_tb: 5, effective_storage_bytes: 1_000_000_000_000 })
    }
    if (url.includes('/billing/payment-method')) return json(route, {}, 404)
    if (url.includes('/billing/winback-eligible')) return json(route, { eligible: false })
    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })
    return json(route, {})
  })
}

async function bootApp(page: Page, path: string, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((t) => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
    localStorage.setItem('beebeeb-theme', t)
  }, theme)
  await page.goto(`${WEB}${path}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
}

const SUMMARY = '/settings/billing'
const CHANGE = '/settings/billing?view=change'

test.describe('1842 no-card trial on the billing pages', () => {
  test('near-cap no-card trial: points at choosing a plan, never at add-on storage', async ({ page }) => {
    const doc = noCardDoc()
    doc.account.storage.used_bytes = 9_500_000_000
    await installMocks(page, NO_CARD_SUB, doc, 9_500_000_000)
    await bootApp(page, CHANGE)
    await expect(page.getByText('Your trial is almost full. Choose a plan to store more.')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Add more storage/i)).toHaveCount(0)
    await expect(page.getByText(/Manage storage/i)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/chooser-no-card-near-cap-light.png`, fullPage: true })
  })


  test('summary: the current-plan card is the trial, not a Pro subscription', async ({ page }) => {
    await installMocks(page, NO_CARD_SUB, noCardDoc())
    await bootApp(page, SUMMARY)
    const name = page.getByTestId('billing-current-plan-name')
    await expect(name).toHaveText('Trial, no card', { timeout: 20_000 })
    const card = page.getByTestId('billing-current-plan-card')
    // No plan, price or billing cycle: there is no subscription.
    await expect(card).not.toContainText(/EUR\s*\d/)
    await expect(card).not.toContainText(/\/\s*month/i)
    await expect(card).not.toContainText(/billed (monthly|annually)/i)
    await expect(card).not.toContainText(/monthly/i)
    await expect(card.getByText('Pro', { exact: true })).toHaveCount(0)
    await expect(card.getByText('Trial', { exact: true })).toHaveCount(0) // the old amber status pill
    // The trial: end date, usage against the 10 GB cap, the read-only / deletion sentence.
    await expect(page.getByTestId('billing-current-plan-trial-ends')).toContainText(/Ends\s+\d{1,2} \w{3} \d{4}/)
    await expect(card).toContainText(/440 B\s*\/\s*10 GB/)
    await expect(page.getByTestId('billing-current-plan-trial-consequence')).toContainText(/read-only and are deleted 14 days later/)
    await expect(page.getByTestId('billing-current-plan-trial-sharing-note')).toContainText(/share links/)
    // The standalone trial panel is gone: the end date is drawn by the card (and the global banner), not three times.
    await expect(page.getByTestId('billing-no-card-trial')).toHaveCount(0)
    // Primary action: Choose a plan, never "Subscribe to Pro" / "Change plan".
    await expect(page.getByTestId('billing-choose-plan')).toHaveText(/Choose a plan/)
    await expect(page.getByRole('button', { name: /Change plan/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Subscribe to Pro/i })).toHaveCount(0)
    await expect(page.getByText(/Switch to annual|Save on your plan/i)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/summary-no-card-light.png`, fullPage: true })
  })

  test('chooser: no annual card, trial current-plan card, Choose a plan, chooser wording', async ({ page }) => {
    await installMocks(page, NO_CARD_SUB, noCardDoc())
    await bootApp(page, CHANGE)
    await expect(page.getByTestId('chooser-current-plan-name')).toHaveText('Trial, no card', { timeout: 20_000 })
    // (1) no annual-switch card, no cycle switching at all
    await expect(page.getByText(/Save on your plan/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Switch to annual|Switch to monthly/i })).toHaveCount(0)
    // (2) the card reads the trial
    const card = page.getByTestId('chooser-current-plan-card')
    await expect(card).not.toContainText(/EUR\s*\d/)
    await expect(card).not.toContainText(/monthly|yearly/i)
    await expect(card.getByText('Trial', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('chooser-current-plan-trial-ends')).toContainText(/Ends\s+\d{1,2} \w{3} \d{4}/)
    await expect(card).toContainText(/440 B\s*\/\s*10 GB/)
    await expect(page.getByTestId('chooser-current-plan-trial-consequence')).toContainText(/read-only and are deleted 14 days later/)
    // (3) primary action
    await expect(page.getByTestId('chooser-choose-plan')).toHaveText(/Choose a plan/)
    await expect(page.getByText(/1 TB base, expandable/)).toHaveCount(0) // Pro's tagline under the page title
    await expect(page.getByRole('button', { name: /Subscribe to Pro/i })).toHaveCount(0)
    await expect(page.getByTestId('trial-subscribe-plan')).toHaveCount(0)
    // (4) compare plans: chooser wording, no renewal / upgrade / downgrade talk, nothing marked current
    const compare = page.getByTestId('compare-plans-copy')
    await expect(compare).not.toContainText(/renewal|upgrade|downgrade/i)
    await expect(page.getByRole('button', { name: /Downgrade/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Upgrade$/ })).toHaveCount(0)
    await expect(page.getByTestId('plan-comparison').getByText('Current', { exact: true })).toHaveCount(0)
    // Other subscription-only elements: storage add-on, payment method, cancel, cycle.
    await expect(page.getByText(/Manage storage/i)).toHaveCount(0)
    await expect(page.getByText(/Payment method/i)).toHaveCount(0)
    await expect(page.getByText(/Cancel plan|Cancel subscription/i)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/chooser-no-card-light.png`, fullPage: true })
  })

  test('chooser: Choose a plan scrolls to the plan table, and a tier opens checkout', async ({ page }) => {
    await installMocks(page, NO_CARD_SUB, noCardDoc())
    await bootApp(page, CHANGE)
    await expect(page.getByTestId('chooser-choose-plan')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('chooser-choose-plan').click()
    const tierButtons = page.getByTestId('plan-comparison').getByRole('button', { name: 'Choose', exact: true })
    await expect(tierButtons.first()).toBeInViewport()
    expect(await tierButtons.count()).toBeGreaterThanOrEqual(2)
    // The last tier button is Pro's: it opens the same upgrade dialog "Subscribe to Pro" used to.
    await tierButtons.last().click()
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeVisible({ timeout: 10_000 })
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`phone width 390px, ${theme}: both views`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await installMocks(page, NO_CARD_SUB, noCardDoc())
      await bootApp(page, SUMMARY, theme)
      await expect(page.getByTestId('billing-current-plan-name')).toHaveText('Trial, no card', { timeout: 20_000 })
      await expect(page.getByTestId('billing-choose-plan')).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      await page.screenshot({ path: `${SHOTS}/summary-no-card-390-${theme}.png`, fullPage: true })
      await page.goto(`${WEB}${CHANGE}`)
      await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
      await expect(page.getByTestId('chooser-current-plan-name')).toHaveText('Trial, no card', { timeout: 20_000 })
      await page.screenshot({ path: `${SHOTS}/chooser-no-card-390-${theme}.png`, fullPage: true })
    })
  }

  test('dark, desktop width: both views', async ({ page }) => {
    await installMocks(page, NO_CARD_SUB, noCardDoc())
    await bootApp(page, SUMMARY, 'dark')
    await expect(page.getByTestId('billing-current-plan-name')).toHaveText('Trial, no card', { timeout: 20_000 })
    await page.screenshot({ path: `${SHOTS}/summary-no-card-dark.png`, fullPage: true })
    await page.goto(`${WEB}${CHANGE}`)
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
    await expect(page.getByTestId('chooser-current-plan-name')).toHaveText('Trial, no card', { timeout: 20_000 })
    await page.screenshot({ path: `${SHOTS}/chooser-no-card-dark.png`, fullPage: true })
  })
})

test.describe('1842 unchanged: card trial and paid Pro', () => {
  test('card trial (a real subscription in trialing) still reads Pro, Monthly, trial', async ({ page }) => {
    await installMocks(page, CARD_TRIAL_SUB)
    await bootApp(page, CHANGE)
    await expect(page.getByTestId('chooser-current-plan-name')).toHaveText('Pro', { timeout: 20_000 })
    const card = page.getByTestId('chooser-current-plan-card')
    await expect(card.getByText('Monthly', { exact: true })).toBeVisible()
    await expect(card.getByText('Trial', { exact: true })).toBeVisible()
    await expect(page.getByText(/Save on your plan/i)).toBeVisible()
    await expect(page.getByTestId('compare-plans-copy')).toContainText(/Upgrades apply immediately; downgrades apply at your next renewal/)
    await expect(page.getByTestId('chooser-current-plan-trial-ends')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/chooser-card-trial-light.png`, fullPage: true })
    await page.goto(`${WEB}${SUMMARY}`)
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
    await expect(page.getByTestId('billing-current-plan-name')).toHaveText('Pro', { timeout: 20_000 })
    await expect(page.getByTestId('billing-current-plan-card')).toContainText(/EUR\s*10\.99\s*\/\s*month/)
    await expect(page.getByTestId('billing-current-plan-card')).toContainText(/billed monthly/)
    await expect(page.getByRole('button', { name: /Change plan/i })).toBeVisible()
  })

  test('paid Pro still reads Pro, Monthly, price, renewal copy', async ({ page }) => {
    await installMocks(page, PAID_SUB)
    await bootApp(page, CHANGE)
    await expect(page.getByTestId('chooser-current-plan-name')).toHaveText('Pro', { timeout: 20_000 })
    const card = page.getByTestId('chooser-current-plan-card')
    await expect(card.getByText('Monthly', { exact: true })).toBeVisible()
    await expect(card.getByText('Active', { exact: true })).toBeVisible()
    await expect(page.getByText(/Save on your plan/i)).toBeVisible()
    await expect(page.getByTestId('compare-plans-copy')).toContainText(/downgrades apply at your next renewal/)
    await expect(page.getByText(/Cancel plan/i).first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/chooser-paid-light.png`, fullPage: true })
    await page.goto(`${WEB}${SUMMARY}`)
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
    await expect(page.getByTestId('billing-current-plan-name')).toHaveText('Pro', { timeout: 20_000 })
    await expect(page.getByTestId('billing-current-plan-card')).toContainText(/EUR\s*10\.99\s*\/\s*month/)
    await expect(page.getByRole('button', { name: /Change plan/i })).toBeVisible()
  })
})
