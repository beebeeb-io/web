/**
 * 1828 — /settings/billing?success=true must not claim "Your subscription is now active".
 * No server: every API call is mocked (pattern of e2e/1542-web-billing-copy.spec.ts).
 * Run: E2E_WEB_URL=http://localhost:38282 bunx playwright test --config=e2e/1828-billing-success-flag.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'e2e/screenshots'

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

function installMocks(page: Page, sub: unknown) {
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

const PRO_SUB = { ...FREE_SUB_TRIAL_USED, plan: 'pro', can_upgrade: false, current_period_end: '2026-11-06T00:00:00Z' }

test.describe('1828 billing return flags', () => {
  test('crafted ?success=true with an unchanged free subscription shows no success banner', async ({ page }) => {
    await installMocks(page, FREE_SUB_TRIAL_USED)
    await bootApp(page, '/settings/billing?success=true')
    await expect(page.getByText(/Free/i).first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    await expect(page.getByText(/subscription is now active/i)).toHaveCount(0)
    await expect(page.getByText(/welcome aboard/i)).toHaveCount(0)
    await expect(page.getByText(/Upgrade complete/i)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/1828-crafted-success-true.png`, fullPage: true })
  })

  test('?upgraded=true with an unchanged subscription claims nothing', async ({ page }) => {
    await installMocks(page, FREE_SUB_TRIAL_USED)
    await bootApp(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/Confirming your payment/i).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Upgrade complete/i)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/1828-upgraded-unchanged-confirming.png`, fullPage: true })
  })

  test('real return: ?upgraded=true with a paid subscription shows Upgrade complete', async ({ page }) => {
    await installMocks(page, PRO_SUB)
    await bootApp(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/Upgrade complete/i)).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: `${SHOTS}/1828-real-return-upgrade-complete.png`, fullPage: true })
  })
})
