/**
 * 0905 — 14-day free trial web UI (UNIT C) — verification spec.
 *
 * Web-app-only: NO server runs. Every API call is mocked with page.route, and
 * the vault unlock uses the REAL WASM crypto path (32 master-key bytes returned
 * by the mocked /dev/auto-login → cacheVaultKey via DevAuthGate). Mirrors the
 * 0865 checkout-redirect spec's mocking + boot pattern.
 *
 * Gates (task 0905 §"Acceptance criteria" — web):
 *   1. Start-trial CTA: a Free-plan user sees "Start 14-day Pro trial" (task
 *      1064, D5: labels now name the tier they act on) + the honest "No card
 *      required" subtext.
 *   2. Trialing banner: GET /billing/subscription → {status:'trialing',
 *      trial_ends_at:<10 days out>} renders "N days left in your free trial" with
 *      an "Add payment method" convert CTA.
 *   3. Convert redirect: clicking the convert CTA issues POST /billing/trial/
 *      convert and redirects to the mocked Mollie hosted-checkout URL — REUSING
 *      the 0865 redirect plumbing (and stamping bb_pending_checkout).
 *
 * Run: bunx playwright test --config=e2e/trial-0905.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

const FREE_SUB = {
  plan: 'free',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: null,
  pending_downgrade_plan: null,
}

/** Active trial ending ~10 days from now (RFC3339), plan = pro. */
function trialingSub() {
  const ends = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
  return {
    plan: 'pro',
    billing_cycle: 'monthly',
    seats: 1,
    region: 'eu-central',
    status: 'trialing',
    created_at: '2026-06-01T00:00:00Z',
    current_period_end: null,
    trial_ends_at: ends,
    pending_downgrade_plan: null,
  }
}

const PLANS = [
  {
    id: 'free', name: 'Free', price_eur: 0, price_yearly_eur: 0,
    storage_bytes: 5_000_000_000, storage_label: '5 GB', per_seat: false,
    min_seats: 1, features: ['5 GB'], is_active: true, sort_order: 0,
  },
  {
    id: 'basic', name: 'Basic', price_eur: 4.99, price_yearly_eur: 49,
    storage_bytes: 500_000_000_000, storage_label: '500 GB', per_seat: false,
    min_seats: 1, features: ['500 GB', 'Priority support'], is_active: true, sort_order: 1,
  },
  {
    id: 'pro', name: 'Pro', price_eur: 9.99, price_yearly_eur: 99,
    storage_bytes: 2_000_000_000_000, storage_label: '2 TB', per_seat: false,
    min_seats: 1, features: ['2 TB', 'Versioning'], is_active: true, sort_order: 2,
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

/**
 * Install the mock backend. `sub` is the subscription payload returned by every
 * GET /billing/subscription. Returns a counter object so tests can assert the
 * convert POST fired with the expected URL handed back.
 */
function installMocks(page: Page, opts: { sub: unknown }) {
  const counters = { convertPosts: 0, trialStartPosts: 0, lastStartBody: null as unknown }

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

    // dev auto-login → real WASM unlock with 32 deterministic bytes
    if (url.includes('/dev/auto-login')) {
      const bytes = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
      const b64 = Buffer.from(bytes).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return json(route, {
        session_token: 'dev-mock-session', master_key_bytes_base64: b64,
        email: 'dev@beebeeb.dev', role: 'user',
      })
    }

    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)

    // ── trial endpoints (task 0905) ──
    if (url.includes('/billing/trial/start')) {
      counters.trialStartPosts += 1
      counters.lastStartBody = JSON.parse(route.request().postData() ?? '{}')
      return json(route, trialingSub(), 201)
    }
    if (url.includes('/billing/trial/convert')) {
      counters.convertPosts += 1
      return json(route, { url: 'https://www.mollie.com/checkout/trial-convert-mock' })
    }

    // ── billing ──
    if (url.includes('/billing/subscription')) return json(route, opts.sub)
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/usage')) {
      return json(route, { used_bytes: 1_200_000_000, file_count: 12 })
    }
    if (url.includes('/billing/storage-addons')) {
      return json(route, {
        extra_storage_tb: 0, base_storage_tb: 0, max_storage_tb: 0,
        effective_storage_bytes: 5_000_000_000,
      })
    }

    // ── drive / preferences (loadData + layout side-fetches) ──
    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })

    return json(route, {})
  }).then(() => counters)
}

async function bootBilling(page: Page, path: string) {
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

test.describe('0905 14-day free trial — web UI (UNIT C)', () => {
  test('GATE 1 — Free user sees the "Start 14-day Pro trial" CTA + honest subtext', async ({ page }) => {
    await installMocks(page, { sub: FREE_SUB })
    await bootBilling(page, '/settings/billing')
    // The trial CTA lives on the "change" view (post-0942 summary/change
    // split — "Choose a plan" opens it), not the /settings/billing summary.
    await page.getByRole('button', { name: /Choose a plan/i }).click()
    await expect(page.getByText(/Plan & billing/i).first()).toBeVisible({ timeout: 15_000 })
    // Task 1064 (D5): the CTA now names the tier it acts on ("Start 14-day Pro
    // trial") instead of a generic "Start 14-day free trial" that always
    // started a Pro trial regardless of label — the per-tier "Compare plans"
    // table is the precise entry point for other tiers.
    await expect(page.getByRole('button', { name: /Start 14-day Pro trial/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/No card required\. Cancel anytime — you keep your files\./i)).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/0905-gate1-start-trial-cta.png', fullPage: true })
  })

  test('GATE 2 — trialing subscription renders the "N days left" banner + convert CTA', async ({ page }) => {
    await installMocks(page, { sub: trialingSub() })
    await bootBilling(page, '/settings/billing')
    await expect(page.getByText(/Plan & billing/i).first()).toBeVisible({ timeout: 15_000 })
    // The "N days left in your free trial" copy renders on BOTH surfaces — the
    // billing-page summary card (h2) AND the global drive/settings banner (span).
    // Assert both are present (proves the page summary + the global banner wire).
    await expect(page.getByText(/days left in your free trial/i).first()).toBeVisible({ timeout: 10_000 })
    expect(await page.getByText(/days left in your free trial/i).count()).toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('heading', { name: /days left in your free trial/i })).toBeVisible()
    // Convert CTA present (the billing-card summary holds it).
    await expect(page.getByRole('button', { name: /Add payment method/i }).first()).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/0905-gate2-trialing-banner.png', fullPage: true })
  })

  test('GATE 3 — convert click POSTs /trial/convert and redirects to the Mollie URL', async ({ page }) => {
    const counters = await installMocks(page, { sub: trialingSub() })
    await bootBilling(page, '/settings/billing')
    await expect(page.getByText(/days left in your free trial/i)).toBeVisible({ timeout: 15_000 })

    // Click the convert CTA. The handler stamps bb_pending_checkout (0865 reuse)
    // then sets window.location.href to the mocked Mollie URL — assert the nav.
    await page.getByRole('button', { name: /Add payment method/i }).first().click()
    await page.waitForURL(/mollie\.com\/checkout\/trial-convert-mock/, { timeout: 15_000 })
    expect(counters.convertPosts).toBeGreaterThanOrEqual(1)
    await page.screenshot({ path: 'e2e/screenshots/0905-gate3-convert-redirect.png', fullPage: true })
  })
})
