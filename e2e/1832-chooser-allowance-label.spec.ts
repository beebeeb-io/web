/**
 * 1832 — /settings/billing?success=true must not claim "Your subscription is now active".
 * No server: every API call is mocked (pattern of e2e/1542-web-billing-copy.spec.ts).
 * Run: E2E_WEB_URL=http://localhost:38282 bunx playwright test --config=e2e/1832-billing-success-flag.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'e2e/screenshots'
import { readFileSync } from 'node:fs'
const ALLOWANCE_DOC = JSON.parse(readFileSync('src/contracts/onboarding/fixtures/account.allowance.web.json', 'utf8'))

const FREE_SUB_TRIAL_USED = {
  plan: 'free',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  billing_state: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: null,
  pending_downgrade_plan: null,
  has_used_trial: true,
  can_upgrade: true,
}

const PLANS = [
  {
    id: 'free', name: 'Free', price_eur: 0, price_yearly_eur: 0,
    storage_bytes: 100_000_000_000, storage_label: '100 GB', per_seat: false,
    min_seats: 1, features: ['100 GB'], is_active: true, sort_order: 0,
  },
  {
    id: 'basic', name: 'Basic', price_eur: 4.99, price_yearly_eur: 49,
    storage_bytes: 200_000_000_000, storage_label: '200 GB', per_seat: false,
    min_seats: 1, features: ['200 GB', 'Priority support'], is_active: true, sort_order: 1,
  },
  {
    id: 'pro', name: 'Pro', price_eur: 10.99, price_yearly_eur: 105.5,
    storage_bytes: 1_000_000_000_000, storage_label: '1 TB', per_seat: false,
    min_seats: 1, features: ['1 TB', 'Versioning'], is_active: true, sort_order: 2,
  },
]

const AUTH_USER = {
  user_id: '00000000-0000-0000-0000-000000000001',
  email: 'dev@beebeeb.dev',
  email_verified: true,
  created_at: '2026-01-01T00:00:00Z',
  role: 'user',
  totp_enabled: false,
}

const CORS = {
  'access-control-allow-origin': WEB,
  'access-control-allow-credentials': 'true',
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  })
}

function installMocks(page: Page, sub: unknown, doc: unknown = null) {
  return page.route('**/*', async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    const isApi = url.includes('/api/v1/') || url.includes('/dev/auto-login')
    if (!isApi) return route.fallback()

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization',
        },
      })
    }

    if (url.includes('/dev/auto-login')) {
      const bytes = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
      const b64 = Buffer.from(bytes).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return json(route, {
        session_token: 'dev-mock-session', user_id: AUTH_USER.user_id,
        master_key_bytes_base64: b64,
        email: 'dev@beebeeb.dev', role: 'user',
      })
    }

    if (url.includes('/api/v1/onboarding')) return doc ? json(route, doc) : json(route, {}, 404)
    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)

    if (url.includes('/billing/subscription')) return json(route, sub)
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/transactions')) return json(route, { transactions: [] })
    if (url.includes('/billing/usage')) {
      return json(route, { used_bytes: 1_200_000_000, file_count: 12 })
    }
    if (url.includes('/billing/storage-addons')) {
      return json(route, {
        extra_storage_tb: 0, base_storage_tb: 0, max_storage_tb: 0,
        effective_storage_bytes: 100_000_000_000,
      })
    }
    if (url.includes('/billing/winback-eligible')) return json(route, { eligible: false })
    if (url.includes('/billing/checkout')) {
      return json(route, { url: 'https://www.mollie.com/checkout/mock-session' })
    }

    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })

    return json(route, {})
  })
}

async function bootApp(page: Page, path: string) {
  await page.addInitScript(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
  })
  await page.goto(`${WEB}${path}`)
  await page.waitForFunction(
    () => document.body.dataset.cryptoReady === 'true',
    { timeout: 20_000 },
  )
}


const NO_PLAN_SUB = { ...FREE_SUB_TRIAL_USED, plan: 'none', status: 'none', has_used_trial: false, account_state: 'needs_plan' }
const TRIAL_SUB = { ...FREE_SUB_TRIAL_USED, plan: 'pro', status: 'trialing', can_upgrade: false, trial_ends_at: '2026-10-20T00:00:00Z', current_period_end: '2026-10-20T00:00:00Z' }
const PRO_SUB = { ...FREE_SUB_TRIAL_USED, plan: 'pro', can_upgrade: false, current_period_end: '2026-11-06T00:00:00Z' }

async function chooser(page: Page) {
  await bootApp(page, '/settings/billing?view=change')
  return page.getByText('Current plan', { exact: true }).first()
}

test.describe('1832 chooser current-plan card', () => {
  test('allowance account: Allowance + the Billing line, never Free', async ({ page }) => {
    await installMocks(page, NO_PLAN_SUB, ALLOWANCE_DOC)
    await bootApp(page, '/settings/billing')
    await expect(page.getByTestId('billing-allowance-line')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /choose a plan/i }).first().click()
    const name = page.getByTestId('chooser-current-plan-name')
    await expect(name).toHaveText('Allowance')
    await expect(page.getByTestId('chooser-allowance-line')).toHaveText('Included with your account. A plan adds storage and sharing.')
    await expect(page.getByText('Free', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/1832-chooser-allowance.png`, fullPage: true })
  })

  test('trialing account keeps its own plan name', async ({ page }) => {
    await installMocks(page, TRIAL_SUB)
    await chooser(page)
    await expect(page.getByTestId('chooser-current-plan-name')).toHaveText('Pro', { timeout: 20_000 })
    await expect(page.getByTestId('chooser-allowance-line')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/1832-chooser-trialing.png`, fullPage: true })
  })

  test('paid account keeps its own plan name', async ({ page }) => {
    await installMocks(page, PRO_SUB)
    await chooser(page)
    await expect(page.getByTestId('chooser-current-plan-name')).toHaveText('Pro', { timeout: 20_000 })
    await expect(page.getByTestId('chooser-allowance-line')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/1832-chooser-paid.png`, fullPage: true })
  })
})
