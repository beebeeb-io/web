/**
 * Task 2092 — pay-now checkout redirect (copied mock harness from 1605) (cancel read-only, 14-day retention
 * dates, 25 GB trial cap, pay-now).
 *
 * Web-app-only: no server runs, every API call is mocked with page.route —
 * mirrors e2e/1542-web-billing-copy.spec.ts / trial-0905.spec.ts (the vault
 * unlock uses the REAL WASM crypto path via the mocked /dev/auto-login).
 *
 * Run: bunx playwright test --config=e2e/2092-pay-now-redirect.config.ts
 * Screenshots: .claude/tasks/_qa-evidence/2092/web/
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5292'
// Default to a repo-relative, always-writable directory (PR #128 review,
// Codex P1: the CI runner has no `/Users/...` and cannot create one, so a
// hardcoded developer path there failed `beforeAll` before any test ran).
// To capture the real task QA evidence, pass the workspace path explicitly:
// `E2E_EVIDENCE_DIR=<workspace>/.claude/tasks/_qa-evidence/2092/web bunx
// playwright test --config=e2e/2092-pay-now-redirect.config.ts`.
const EVIDENCE_DIR =
  process.env.E2E_EVIDENCE_DIR ?? path.resolve(__dirname, '../test-results/2092')

const ACCESS_UNTIL = '2026-10-13T00:00:00Z'
const DATA_DELETION_AT = '2026-10-27T00:00:00Z'
const TRIAL_ENDS_AT = '2026-10-13T00:00:00Z'
const TRIAL_CAP_BYTES = 25_000_000_000

const CANCELLED_TRIAL_SUB = {
  plan: 'basic',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'cancelling',
  billing_state: 'cancelling',
  created_at: '2026-09-01T00:00:00Z',
  current_period_end: ACCESS_UNTIL,
  trial_ends_at: TRIAL_ENDS_AT,
  trial_auto_converts: true,
  pending_downgrade_plan: null,
  has_used_trial: true,
  can_upgrade: false,
  account_state: 'ok',
  uploads_blocked_at: '2026-09-29T09:00:00Z',
  access_until: ACCESS_UNTIL,
  data_deletion_at: DATA_DELETION_AT,
  trial_storage_cap_bytes: null,
}

const CAPPED_TRIAL_SUB = {
  plan: 'basic',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'trialing',
  billing_state: 'trialing',
  created_at: '2026-09-29T00:00:00Z',
  current_period_end: TRIAL_ENDS_AT,
  trial_ends_at: TRIAL_ENDS_AT,
  trial_auto_converts: true,
  pending_downgrade_plan: null,
  has_used_trial: true,
  can_upgrade: false,
  account_state: 'ok',
  uploads_blocked_at: null,
  access_until: null,
  data_deletion_at: null,
  trial_storage_cap_bytes: TRIAL_CAP_BYTES,
}

const PLANS = [
  {
    id: 'basic', name: 'Basic', price_eur: 4.99, price_yearly_eur: 49,
    storage_bytes: 200_000_000_000, storage_label: '200 GB', per_seat: false,
    min_seats: 1, features: ['200 GB'], is_active: true, sort_order: 1,
  },
  {
    id: 'pro', name: 'Pro', price_eur: 10.99, price_yearly_eur: 105.5,
    storage_bytes: 1_000_000_000_000, storage_label: '1 TB', per_seat: false,
    min_seats: 1, features: ['1 TB'], is_active: true, sort_order: 2,
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

interface MockOptions {
  /** Mutable — GET /billing/subscription always reads the CURRENT value. */
  sub: Record<string, unknown>
  /** Called on POST /billing/trial/pay-now; returns the response body. */
  onPayNow?: () => { status: number; body: unknown }
  /** Called on GET /billing/payment/{id}/status. */
  onPaymentStatus?: (id: string) => { status: number; body: unknown }
  /** Called on POST /api/v1/uploads/init; returns the response, or null to fall through to the default 201. */
  onUploadInit?: () => { status: number; body: unknown } | null
}

function installMocks(page: Page, opts: MockOptions) {
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

    if (url.includes('/billing/trial/pay-now') && method === 'POST') {
      const result = opts.onPayNow?.() ?? { status: 200, body: { payment_id: 'tr_mock_default', status: 'paid' } }
      return json(route, result.body, result.status)
    }
    if (/\/billing\/payment\/[^/]+\/status/.test(url)) {
      const id = decodeURIComponent(url.match(/payment\/([^/]+)\/status/)![1])
      const r = opts.onPaymentStatus?.(id) ?? { status: 200, body: { payment_id: id, status: 'paid', converged: true, cached: false, checked: true } }
      return json(route, r.body, r.status)
    }
    if (url.includes('/billing/subscription')) return json(route, opts.sub)
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/transactions')) return json(route, { transactions: [] })
    if (url.includes('/billing/usage')) return json(route, { used_bytes: 1_200_000_000, file_count: 12 })
    if (url.includes('/billing/storage-addons')) {
      return json(route, { extra_storage_tb: 0, base_storage_tb: 0, max_storage_tb: 0, effective_storage_bytes: 200_000_000_000 })
    }
    if (url.includes('/billing/checkout')) return json(route, { url: 'https://www.mollie.com/checkout/mock-session' })

    if (url.includes('/uploads/init') && method === 'POST') {
      const result = opts.onUploadInit?.()
      if (result) return json(route, result.body, result.status)
      return json(route, {
        upload_session_id: 'sess_mock', file_id: 'file_mock', object_version_id: 'ov_mock',
        chunk_size_bytes: 4_194_304, chunk_count: 1, storage_pool_id: 'pool_mock', region: 'eu-central',
        lease_expires_at: new Date(Date.now() + 3_600_000).toISOString(), lease_seconds: 3600, heartbeat_interval_secs: 1200,
      })
    }

    if (url.includes('/files/usage')) {
      return json(route, { used_bytes: 1_200_000_000, plan_limit_bytes: 200_000_000_000, plan_name: (opts.sub.plan as string) ?? 'basic' })
    }
    if (url.includes('/files/count')) {
      return json(route, { total_files: 0, total_folders: 0, total_bytes: 0, trashed_files: 0, trashed_bytes: 0 })
    }
    if (url.includes('/files/all-images')) return json(route, { files: [] })
    if (url.includes('/notifications')) return json(route, { notifications: [], unread_count: 0 })
    if (url.includes('/files')) return json(route, { files: [] })
    // Mark the welcome tour already seen — it's unrelated to task 1605 and
    // otherwise overlays the drive page on every fresh dev-auto-login mock.
    if (url.includes('/preferences/welcome_tour')) {
      return json(route, { value: { seen: true, completed: ['upload', 'security', 'share', 'device'] } })
    }
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })

    return json(route, {})
  })
}

async function bootApp(page: Page, appPath: string) {
  await page.addInitScript(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
    // Not the feature under test — the storage-quota upgrade nudge modal
    // (upgrade-nudge-modal.tsx) reads driveUsage before this harness's mock
    // response lands on the first render and can show once per session;
    // suppress it via its own documented sessionStorage flag.
    sessionStorage.setItem('beebeeb_upgrade_nudge_dismissed', '1')
  })
  await page.goto(`${WEB}${appPath}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
}


test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
})

const CHECKOUT = 'https://checkout.example.test/pay/tr_mock_3ds'
const STATUS_RESP = (id: string, status: string) => ({ status: 200, body: { payment_id: id, status, converged: true, cached: false, checked: true } })

test.describe('2092 — pay now follows the hosted checkout (3-D Secure)', () => {
  test('click Pay now -> redirected to checkout_url -> return -> status polled -> paid', async ({ page }) => {
    const sub: Record<string, unknown> = { ...CAPPED_TRIAL_SUB }
    const statusCalls: string[] = []
    await installMocks(page, {
      sub,
      onPayNow: () => ({ status: 200, body: { payment_id: 'tr_mock_3ds', status: 'open', checkout_url: CHECKOUT, pending: true, reused: false, amount_cents: 1990 } }),
      onPaymentStatus: (id) => {
        statusCalls.push(id)
        if (statusCalls.length === 1) return STATUS_RESP(id, 'open')
        sub.status = 'active'; sub.billing_state = 'active'; sub.trial_storage_cap_bytes = null
        return STATUS_RESP(id, 'paid')
      },
    })
    // The hosted checkout is external: capture the navigation and bounce straight back like the bank flow would.
    let redirectedTo: string | null = null
    await page.route(CHECKOUT, (route) => {
      redirectedTo = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>mock hosted checkout</body></html>' })
    })
    await bootApp(page, '/billing')
    await page.getByTestId('pay-now-button').click()
    await expect.poll(() => redirectedTo, { timeout: 15_000 }).toBe(CHECKOUT)

    // The bank is done; checkout sends the person back.
    await page.goto(`${WEB}/billing?trial_pay_now=returned`)
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
    const banner = page.getByTestId('pay-now-return')
    await expect(banner).toHaveAttribute('data-kind', 'paid', { timeout: 20_000 })
    await expect(banner).toContainText('Payment received — your plan is active.')
    expect(statusCalls.length).toBeGreaterThanOrEqual(2)
    expect(statusCalls.every((id) => id === 'tr_mock_3ds')).toBe(true)
    expect(page.url()).not.toContain('trial_pay_now')
    await page.screenshot({ path: `${EVIDENCE_DIR}/2092-paid.png`, fullPage: true })
  })

  test('return with a failed payment: honest copy and a retry', async ({ page }) => {
    await installMocks(page, {
      sub: { ...CAPPED_TRIAL_SUB },
      onPaymentStatus: (id) => STATUS_RESP(id, 'failed'),
    })
    await page.addInitScript(() => sessionStorage.setItem('bb_pay_now_payment_id', 'tr_failed'))
    await bootApp(page, '/billing?trial_pay_now=returned')
    const banner = page.getByTestId('pay-now-return')
    await expect(banner).toHaveAttribute('data-kind', 'failed', { timeout: 20_000 })
    await expect(banner).toContainText("Your bank didn't confirm the payment. Nothing was charged.")
    await expect(page.getByTestId('pay-now-return-retry')).toBeVisible()
    await expect(banner).not.toContainText(/mollie/i)
    await page.screenshot({ path: `${EVIDENCE_DIR}/2092-failed.png`, fullPage: true })
  })

  test('canceled return: nothing charged, param cleaned', async ({ page }) => {
    await installMocks(page, { sub: { ...CAPPED_TRIAL_SUB } })
    await bootApp(page, '/billing?trial_pay_now=canceled')
    const banner = page.getByTestId('pay-now-return')
    await expect(banner).toHaveAttribute('data-kind', 'canceled', { timeout: 20_000 })
    await expect(banner).toContainText('Payment cancelled. Nothing was charged.')
    expect(page.url()).not.toContain('trial_pay_now')
    await page.screenshot({ path: `${EVIDENCE_DIR}/2092-canceled.png`, fullPage: true })
  })

  test('OLD server (no checkout_url): no redirect, legacy pending flow unchanged', async ({ page }) => {
    await installMocks(page, {
      sub: { ...CAPPED_TRIAL_SUB },
      onPayNow: () => ({ status: 200, body: { payment_id: 'tr_legacy', pending: true } }),
    })
    await bootApp(page, '/billing')
    await page.getByTestId('pay-now-button').click()
    await expect(page.getByTestId('pay-now-pending')).toBeVisible({ timeout: 10_000 })
    expect(page.url()).toContain('/billing')
  })

  test('waiting past the bound keeps the marker; Refresh re-checks and settles', async ({ page }) => {
    const sub: Record<string, unknown> = { ...CAPPED_TRIAL_SUB }
    let settle = false
    const statusCalls: string[] = []
    await installMocks(page, {
      sub,
      onPaymentStatus: (id) => {
        statusCalls.push(id)
        if (!settle) return STATUS_RESP(id, 'open')
        sub.status = 'active'; sub.billing_state = 'active'; sub.trial_storage_cap_bytes = null
        return STATUS_RESP(id, 'paid')
      },
    })
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('bb_pay_now_seeded')) {
        sessionStorage.setItem('bb_pay_now_seeded', '1')
        sessionStorage.setItem('bb_pay_now_payment_id', 'tr_slow')
      }
    })
    await page.clock.install()
    await bootApp(page, '/billing?trial_pay_now=returned')
    const banner = page.getByTestId('pay-now-return')
    await expect(banner).toHaveAttribute('data-kind', 'checking', { timeout: 20_000 })
    // Stay 'open' past the 60 s bound.
    for (let i = 0; i < 25; i++) await page.clock.fastForward(3_000)
    await expect(banner).toHaveAttribute('data-kind', 'waiting', { timeout: 20_000 })
    await expect(page.getByTestId('pay-now-return-refresh')).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('bb_pay_now_payment_id'))).toBe('tr_slow')

    settle = true
    await page.getByTestId('pay-now-return-refresh').click()
    await expect(banner).toHaveAttribute('data-kind', 'paid', { timeout: 20_000 })
    await expect(banner).toContainText('Payment received — your plan is active.')
    expect(await page.evaluate(() => sessionStorage.getItem('bb_pay_now_payment_id'))).toBeNull()
    expect(statusCalls.every((id) => id === 'tr_slow')).toBe(true)
  })
})
