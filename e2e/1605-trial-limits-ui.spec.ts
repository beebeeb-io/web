/**
 * Task 1605 — unpaid-trial limits UI (cancel read-only, 14-day retention
 * dates, 25 GB trial cap, pay-now).
 *
 * Web-app-only: no server runs, every API call is mocked with page.route —
 * mirrors e2e/1542-web-billing-copy.spec.ts / trial-0905.spec.ts (the vault
 * unlock uses the REAL WASM crypto path via the mocked /dev/auto-login).
 *
 * Run: bunx playwright test --config=e2e/1605-trial-limits-ui.config.ts
 * Screenshots: .claude/tasks/_qa-evidence/1605/web/
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5205'
// The worktree (this repo checkout) and the workspace root (where task
// evidence lives) are separate trees — not reachable via a relative path
// from __dirname — so this is an absolute path, overridable for a different
// workspace location.
const EVIDENCE_DIR =
  process.env.E2E_EVIDENCE_DIR ??
  '/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/1605/web'

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
    if (url.includes('/billing/subscription')) return json(route, opts.sub)
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/transactions')) return json(route, { transactions: [] })
    if (url.includes('/billing/usage')) return json(route, { used_bytes: 1_200_000_000, file_count: 12 })
    if (url.includes('/billing/storage-addons')) {
      return json(route, { extra_storage_tb: 0, base_storage_tb: 0, max_storage_tb: 0, effective_storage_bytes: 200_000_000_000 })
    }
    if (url.includes('/billing/winback-eligible')) return json(route, { eligible: false })
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

test.describe('1605 — cancelled never-paid trial: dates, no "Renews"', () => {
  test('Storage & Plan shows Uploads stopped · Access until · Files deleted on', async ({ page }) => {
    await installMocks(page, { sub: { ...CANCELLED_TRIAL_SUB } })
    await bootApp(page, '/billing')

    const card = page.getByTestId('cancelling-card')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toHaveAttribute('data-cancel-kind', 'never_paid_trial')

    const headline = page.getByTestId('cancelling-headline')
    await expect(headline).toContainText('Uploads stopped')
    await expect(headline).toContainText('Access until')
    await expect(headline).toContainText('Files deleted on')

    // The wrong pre-1605 copy, and any stray "Renews", must be gone.
    await expect(page.getByText(/stays fully active until/i)).toHaveCount(0)
    await expect(page.getByText(/^Renews/)).toHaveCount(0)

    await page.screenshot({ path: `${EVIDENCE_DIR}/1605-cancelled-trial-dates.png`, fullPage: true })
  })
})

test.describe('1605 — active mandated trial: 25 GB cap + pay-now', () => {
  test('trial card shows the 25 GB cap explainer and a Pay now button', async ({ page }) => {
    await installMocks(page, { sub: { ...CAPPED_TRIAL_SUB } })
    await bootApp(page, '/billing')

    const card = page.getByTestId('trial-cap-card')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('trial-cap-explainer')).toContainText('25 GB during your trial')
    await expect(page.getByTestId('trial-cap-explainer')).toContainText('full Basic storage after your first payment')

    const payNowButton = page.getByTestId('pay-now-button')
    await expect(payNowButton).toBeVisible()
    await expect(payNowButton).toHaveText('Pay now to unlock Basic storage')

    await page.screenshot({ path: `${EVIDENCE_DIR}/1605-trial-cap-pay-now.png`, fullPage: true })
  })

  test('clicking Pay now while a SEPA mandate settles shows a pending/processing state', async ({ page }) => {
    const sub = { ...CAPPED_TRIAL_SUB }
    await installMocks(page, {
      sub,
      onPayNow: () => ({ status: 200, body: { payment_id: 'tr_mock_pending', pending: true } }),
    })
    await bootApp(page, '/billing')

    const payNowButton = page.getByTestId('pay-now-button')
    await expect(payNowButton).toBeVisible({ timeout: 15_000 })
    await payNowButton.click()

    await expect(page.getByTestId('pay-now-pending')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('pay-now-pending')).toContainText('processing')
    // Double-click safety: the button disables while in flight.
    await expect(payNowButton).toBeDisabled()

    await page.screenshot({ path: `${EVIDENCE_DIR}/1605-pay-now-pending.png`, fullPage: true })
  })
})

test.describe('1605 — read-only upload after a never-paid trial cancel', () => {
  test('an upload attempt shows a clear, honest refusal message, not a generic error', async ({ page }) => {
    await installMocks(page, {
      sub: { ...CANCELLED_TRIAL_SUB },
      onUploadInit: () => ({
        status: 409,
        body: {
          error: 'trial_cancelled_read_only',
          message: 'Uploads are off until you resume your trial or pay now.',
        },
      }),
    })
    await bootApp(page, '/')

    const tmpFile = path.join(os.tmpdir(), `1605-readonly-upload-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'task 1605 read-only upload probe\n')

    await page.locator('input[type="file"]').first().setInputFiles(tmpFile)

    // Two honest surfaces render for this refusal (the toast notice from
    // account-state.ts's uploadRefusalNotice, and the inline upload-row
    // error from user-friendly-error.ts) — both say "uploads are off" /
    // "cancelled your trial", never a generic error.
    await expect(page.getByText(/uploads are off/i).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/cancelled your trial before its first payment/i).first()).toBeVisible()
    // Never the generic "Upload failed" toast for this refusal.
    await expect(page.getByText(/^Upload failed$/)).toHaveCount(0)

    await page.screenshot({ path: `${EVIDENCE_DIR}/1605-readonly-upload-error.png`, fullPage: true })

    fs.rmSync(tmpFile, { force: true })
  })
})
