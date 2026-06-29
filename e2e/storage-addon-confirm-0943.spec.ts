/**
 * 0943 — storage-addon upgrade confirmation + real-time billing_updated WS.
 *
 * Web-app-only: NO server runs. Every API call is mocked with page.route, the
 * vault unlock uses the REAL WASM crypto path, and the WebSocket is faked via an
 * init script so the test can push a `billing_updated` frame on demand.
 *
 * Gates (task 0943):
 *   A1 — poll-confirmed STORAGE upgrade: an instant-pay storage add-on raises
 *        extra_storage_tb only (plan stays pro) → Finalizing flips to Upgrade
 *        complete via the poll. This is the ship-blocking bug fix.
 *   A2 — SEPA-mandate sub, sub never changes past the poll cap → the honest
 *        "Upgrade pending / charged to your SEPA mandate" state, NOT a failure.
 *   B  — real-time WS: a pushed `billing_updated` event confirms IMMEDIATELY
 *        (well before the ~2s first poll tick) when the refetched sub reflects
 *        the storage increase.
 *   REGRESSION — a PLAN upgrade (free → pro) still confirms (poll fix intact).
 *
 * Run: bunx playwright test --config=e2e/storage-addon-confirm-0943.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

// Pro sub, SEPA mandate, no add-on yet — the pre-checkout baseline.
const PRO_SUB_SEPA = {
  plan: 'pro',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: '2026-07-25T00:00:00Z',
  pending_downgrade_plan: null,
  mandate_method: 'directdebit',
  extra_storage_tb: 0,
}

// Same sub AFTER the storage add-on grant lands: +2 TB, everything else equal.
const PRO_SUB_SEPA_UPGRADED = {
  ...PRO_SUB_SEPA,
  extra_storage_tb: 2,
}

const FREE_SUB = {
  plan: 'free',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: null,
  pending_downgrade_plan: null,
  extra_storage_tb: 0,
}

const PRO_SUB_PLAN = {
  plan: 'pro',
  billing_cycle: 'yearly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: '2027-06-25T00:00:00Z',
  pending_downgrade_plan: null,
  extra_storage_tb: 0,
}

const PLANS = [
  {
    id: 'free', name: 'Free', price_eur: 0, price_yearly_eur: 0,
    storage_bytes: 5_000_000_000, storage_label: '5 GB', per_seat: false,
    min_seats: 1, features: ['5 GB'], is_active: true, sort_order: 0,
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
 * `subForRequest(n)` returns a different subscription payload per successive
 * GET /billing/subscription call so the poll (and the WS refetch) can flip from
 * the baseline to the upgraded sub. `addonForRequest(n)` mirrors that for the
 * GET /billing/addons effective-storage read.
 */
function installMocks(
  page: Page,
  opts: {
    subForRequest?: (n: number, upgraded: boolean) => unknown
    addonForRequest?: (n: number) => unknown
  } = {},
) {
  const counters = { subscriptionGets: 0, addonGets: 0, upgraded: false }

  return page.route('**/*', async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    const isApi = url.includes('/api/v1/') || url.includes('/dev/auto-login')
    if (!isApi) return route.fallback()

    // Test-only sentinel: flip the mocked backend to its post-grant state so
    // the WS-triggered refetch (and only it) sees the upgraded subscription —
    // independent of how many initial-load GETs ran first.
    if (url.includes('/__test/upgrade')) {
      counters.upgraded = true
      return json(route, { ok: true })
    }

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
        session_token: 'dev-mock-session', master_key_bytes_base64: b64,
        email: 'dev@beebeeb.dev', role: 'user',
      })
    }

    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)
    // Let the WS open with a token (the page fakes window.WebSocket).
    if (url.includes('/sync/stream-token')) return json(route, { stream_token: 'mock-stream-token' })

    if (url.includes('/billing/subscription')) {
      const n = counters.subscriptionGets
      counters.subscriptionGets += 1
      return json(route, opts.subForRequest ? opts.subForRequest(n, counters.upgraded) : PRO_SUB_SEPA)
    }
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/transactions')) return json(route, { transactions: [] })
    if (url.includes('/billing/usage')) {
      return json(route, { used_bytes: 1_200_000_000, file_count: 12 })
    }
    if (url.includes('/billing/payment-method')) return json(route, {}, 404)
    if (url.includes('/billing/addons')) {
      const n = counters.addonGets
      counters.addonGets += 1
      const body = opts.addonForRequest
        ? opts.addonForRequest(n)
        : { plan: 'pro', extra_storage_tb: 0, base_storage_tb: 2, max_storage_tb: 20, effective_storage_bytes: 2_000_000_000_000 }
      return json(route, body)
    }

    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })

    return json(route, {})
  }).then(() => counters)
}

/**
 * Fake `window.WebSocket` so the app's useWebSocket hook gets a connection that
 * "opens" immediately and exposes `window.__pushWsEvent(obj)` to inject frames.
 * Must run before any app script (addInitScript).
 */
async function fakeWebSocket(page: Page) {
  await page.addInitScript(() => {
    class FakeWS extends EventTarget {
      static OPEN = 1
      static CLOSED = 3
      readyState = 1
      onopen: ((e: Event) => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onclose: ((e: CloseEvent) => void) | null = null
      onerror: ((e: Event) => void) | null = null
      url: string
      constructor(url: string) {
        super()
        this.url = url
        setTimeout(() => {
          this.readyState = 1
          this.onopen?.(new Event('open'))
          ;(window as unknown as { __wsList: FakeWS[] }).__wsList ??= []
          ;(window as unknown as { __wsList: FakeWS[] }).__wsList.push(this)
        }, 0)
      }
      send() {}
      close() {
        this.readyState = 3
        this.onclose?.(new CloseEvent('close', { code: 1000 }))
      }
    }
    ;(window as unknown as { WebSocket: unknown }).WebSocket = FakeWS as unknown
    ;(window as unknown as { __pushWsEvent: (o: unknown) => number }).__pushWsEvent = (obj: unknown) => {
      const list = (window as unknown as { __wsList?: FakeWS[] }).__wsList ?? []
      let delivered = 0
      for (const ws of list) {
        ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify(obj) }))
        delivered += 1
      }
      return delivered
    }
  })
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

test.describe('0943 storage-addon confirmation + real-time WS', () => {
  test('A1 — storage add-on poll-confirms (plan unchanged, extra_storage_tb rises)', async ({ page }) => {
    // Poll #0 = initial loadData fetch (baseline, 0 TB). After 3 GETs the grant
    // has landed → +2 TB. Plan stays "pro" the whole time.
    await fakeWebSocket(page)
    await installMocks(page, {
      subForRequest: (n) => (n >= 3 ? PRO_SUB_SEPA_UPGRADED : PRO_SUB_SEPA),
      addonForRequest: (n) =>
        n >= 1
          ? { plan: 'pro', extra_storage_tb: 2, base_storage_tb: 2, max_storage_tb: 20, effective_storage_bytes: 4_000_000_000_000 }
          : { plan: 'pro', extra_storage_tb: 0, base_storage_tb: 2, max_storage_tb: 20, effective_storage_bytes: 2_000_000_000_000 },
    })
    await bootBilling(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/Finalizing your upgrade/i)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/0943-a1-finalizing.png', fullPage: true })
    await expect(page.getByText(/Upgrade complete/i)).toBeVisible({ timeout: 25_000 })
    await page.screenshot({ path: 'e2e/screenshots/0943-a1-complete.png', fullPage: true })
  })

  test('A2 — SEPA mandate, sub never changes → honest pending state, not "couldn\'t confirm"', async ({ page }) => {
    await fakeWebSocket(page)
    // Sub stays at the SEPA baseline (deferred debit not yet settled).
    await installMocks(page, { subForRequest: () => PRO_SUB_SEPA })
    await bootBilling(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/Finalizing your upgrade/i)).toBeVisible({ timeout: 15_000 })
    // Wait out the ~30s poll cap → SEPA-aware pending copy.
    await expect(page.getByText(/Upgrade pending/i)).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/charged to your SEPA mandate/i)).toBeVisible()
    // Must NOT imply failure or claim success.
    await expect(page.getByText(/was not completed/i)).toHaveCount(0)
    await expect(page.getByText(/Upgrade complete/i)).toHaveCount(0)
    await page.screenshot({ path: 'e2e/screenshots/0943-a2-sepa-pending.png', fullPage: true })
  })

  test('B — real-time billing_updated WS confirms immediately', async ({ page }) => {
    await fakeWebSocket(page)
    // The sub stays at the SEPA baseline (extra 0) — including for every
    // initial-load GET, so the baseline snapshot is captured as 0 TB — until the
    // test flips the `__test/upgrade` sentinel. Then the WS-triggered refetch
    // sees +2 TB and confirms instantly, BEFORE the next 2s poll tick.
    await installMocks(page, {
      subForRequest: (_n, upgraded) => (upgraded ? PRO_SUB_SEPA_UPGRADED : PRO_SUB_SEPA),
      addonForRequest: () =>
        ({ plan: 'pro', extra_storage_tb: 2, base_storage_tb: 2, max_storage_tb: 20, effective_storage_bytes: 4_000_000_000_000 }),
    })
    await bootBilling(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/Finalizing your upgrade/i)).toBeVisible({ timeout: 15_000 })
    // Flip the backend to its post-grant state, THEN push the WS event. The WS
    // handler's refetch now returns the upgraded sub → instant confirm.
    const delivered = await page.evaluate(async () => {
      await fetch('/api/v1/__test/upgrade')
      return (window as unknown as { __pushWsEvent: (o: unknown) => number }).__pushWsEvent({
        type: 'billing_updated',
        data: { reason: 'storage_addon' },
        timestamp: new Date().toISOString(),
      })
    })
    expect(delivered).toBeGreaterThan(0)
    await expect(page.getByText(/Upgrade complete/i)).toBeVisible({ timeout: 8_000 })
    await page.screenshot({ path: 'e2e/screenshots/0943-b-ws-instant-confirm.png', fullPage: true })
  })

  test('REGRESSION — a PLAN upgrade (free → pro) still poll-confirms', async ({ page }) => {
    await fakeWebSocket(page)
    await installMocks(page, { subForRequest: (n) => (n >= 3 ? PRO_SUB_PLAN : FREE_SUB) })
    await bootBilling(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/Finalizing your upgrade/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Upgrade complete/i)).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText(/Welcome to Pro/i)).toBeVisible({ timeout: 5_000 })
    await page.screenshot({ path: 'e2e/screenshots/0943-regression-plan-upgrade.png', fullPage: true })
  })
})
