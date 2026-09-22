/**
 * 0957 — checkout-confirmation resilience: persisted intent + reconcile-on-load
 * (spec §3.3 Component C) — verification spec.
 *
 * Web-app-only: NO server runs, mirroring checkout-redirect-0865.spec.ts's
 * pattern exactly (every API call mocked via page.route, real WASM vault
 * unlock via the mocked /dev/auto-login). The WS `billing_updated` event is
 * never wired in this harness at all (no real WebSocket connects when there's
 * no real server) — every scenario below is inherently "WS event suppressed",
 * which is exactly the condition spec §3.3 item 2 targets: reconciliation
 * must succeed WITHOUT the WS accelerator, via the new
 * `GET /payment/{id}/status` endpoint instead.
 *
 * Scenarios (task 0957's verification ladder):
 *   A. Reconcile-on-load via the NEW status endpoint confirms a checkout even
 *      though the URL carries no `?upgraded=true` signal the banner needs —
 *      proves the client actually calls `GET /payment/{id}/status` (not just
 *      trusting the URL flag or an event).
 *   B. Degraded endpoint (404 — an older server / missing route): the page
 *      must NOT hang or error: it falls back to the pre-0957
 *      subscription-poll path and still confirms.
 *   C. Reload with a pending (not yet returned) intent: the watchdog
 *      "didn't complete checkout" banner is offered — proves the intent
 *      (now carrying `paymentId`) survives a reload via localStorage.
 *   D. WS-reconnect catch-up: dispatching `beebeeb:ws-connected` with a
 *      pending intent triggers an immediate re-check (spec §3.3 item 3).
 *
 * Run: bunx playwright test --config=e2e/checkout-confirmation-resilience-0957.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import path from 'node:path'
import { mkdirSync } from 'node:fs'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

// Defaults to a repo-relative test-results dir (works from any worktree,
// unlike a hardcoded absolute workspace-root path — PR #53 review: the old
// default was one developer's macOS path, so the suite failed taking
// evidence screenshots on any other machine/CI runner where that path can't
// be created). Override with E2E_EVIDENCE_DIR to land screenshots under the
// workspace's tracked `.claude/tasks/_qa-evidence/0957/` for the real
// evidence capture, e.g.:
//   E2E_EVIDENCE_DIR=/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/0957 \
//     bunx playwright test -c e2e/checkout-confirmation-resilience-0957.config.ts
const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? path.join(process.cwd(), 'test-results', '0957-evidence')

const FREE_SUB = {
  plan: 'free',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: null,
  extra_storage_tb: 0,
  storage_tb_quantity: 0,
  mandate_method: null,
  pending_downgrade_plan: null,
}

const PRO_SUB = {
  plan: 'pro',
  billing_cycle: 'yearly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: '2027-06-25T00:00:00Z',
  extra_storage_tb: 0,
  storage_tb_quantity: 0,
  mandate_method: 'creditcard',
  pending_downgrade_plan: null,
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

const PAYMENT_ID = 'tr_0957_test_payment'

/** The app fetches with credentials: 'include', so CORS forbids a wildcard
 *  Allow-Origin — echo the real web origin + allow credentials. */
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

interface MockOpts {
  subForRequest?: (n: number) => unknown
  /** `undefined` = 404 (endpoint absent — the degraded-endpoint scenario). */
  paymentStatus?: () => { status: number; body?: unknown }
}

function installMocks(page: Page, opts: MockOpts = {}) {
  const counters = { subscriptionGets: 0, paymentStatusGets: 0 }

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
        session_token: 'dev-mock-session', master_key_bytes_base64: b64,
        email: 'dev@beebeeb.dev', role: 'user',
      })
    }

    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)

    // task 0957 — the new endpoint. Matched BEFORE the generic
    // `/billing/subscription` check below (distinct path, but keep the
    // ordering explicit since both live under `/billing/`).
    if (url.includes(`/billing/payment/${PAYMENT_ID}/status`)) {
      counters.paymentStatusGets += 1
      if (!opts.paymentStatus) {
        // No mock configured — an older server without this route, or a
        // payment id it never saw. Client must degrade, not hang.
        return json(route, { error: 'not_found' }, 404)
      }
      const { status, body } = opts.paymentStatus()
      return json(route, body ?? {}, status)
    }

    if (url.includes('/billing/subscription')) {
      const n = counters.subscriptionGets
      counters.subscriptionGets += 1
      const body = opts.subForRequest ? opts.subForRequest(n) : FREE_SUB
      return json(route, body)
    }
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/invoices')) return json(route, { invoices: [] })
    if (url.includes('/billing/usage')) return json(route, { used_bytes: 1_200_000_000, file_count: 12 })
    if (url.includes('/billing/storage-addons')) {
      return json(route, { extra_storage_tb: 0, base_storage_tb: 0, max_storage_tb: 0, effective_storage_bytes: 5_000_000_000 })
    }
    if (url.includes('/billing/trial/start')) return json(route, { error: 'trial_already_used' }, 409)

    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })

    return json(route, {})
  }).then(() => counters)
}

async function bootBilling(page: Page, path_: string, intent?: unknown) {
  await page.addInitScript(
    ({ intentToSeed }) => {
      localStorage.setItem('bb_cookie_consent', 'all')
      localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
      if (intentToSeed) {
        localStorage.setItem('bb_pending_checkout', JSON.stringify(intentToSeed))
      }
    },
    { intentToSeed: intent ?? null },
  )
  await page.goto(`${WEB}${path_}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
}

function proIntent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'plan',
    plan: 'pro',
    cycle: 'yearly',
    pre: {
      plan: 'free', cycle: 'monthly', status: 'active', periodEnd: null,
      extraStorageTb: 0, storageTbQuantity: 0, mandateMethod: null,
    },
    ts: Date.now(),
    paymentId: PAYMENT_ID,
    ...overrides,
  }
}

test.describe('0957 checkout-confirmation resilience (spec §3.3 Component C)', () => {
  test.beforeAll(() => {
    mkdirSync(EVIDENCE_DIR, { recursive: true })
  })

  test('A — reconcile-on-load confirms via GET /payment/{id}/status, WS suppressed, no ?upgraded flag', async ({ page }) => {
    // Subscription ALREADY reflects the upgrade (the webhook landed, but the
    // ONLY signal we have is the persisted intent + the new endpoint — no
    // `?upgraded=true`, no WS event fires in this harness at all).
    const counters = await installMocks(page, {
      subForRequest: () => PRO_SUB,
      paymentStatus: () => ({ status: 200, body: { payment_id: PAYMENT_ID, status: 'paid', converged: true, cached: false, checked: true } }),
    })
    await bootBilling(page, '/settings/billing', proIntent())

    // The endpoint must actually be CALLED — this is the load-bearing
    // assertion: reconciliation is not just "the subscription happened to
    // already say pro", it went through the new source-of-truth check.
    await expect.poll(() => counters.paymentStatusGets, { timeout: 15_000 }).toBeGreaterThan(0)

    // The intent is cleared once the reconcile confirms — the SAME
    // localStorage record the watchdog banner reads from, and the ground
    // truth this task's reconcile-on-load is meant to reach without any
    // `?upgraded=true` flag or WS event at all.
    await expect.poll(
      () => page.evaluate(() => localStorage.getItem('bb_pending_checkout')),
      { timeout: 10_000 },
    ).toBeNull()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'A-confirmed-via-payment-status.png'), fullPage: true })
  })

  test('B — degraded endpoint (404) falls back to the subscription-poll path and still confirms', async ({ page }) => {
    let anchorAt: number | null = null
    await installMocks(page, {
      // paymentStatus intentionally omitted → every call 404s.
      subForRequest: () => {
        if (anchorAt === null) anchorAt = Date.now()
        return Date.now() - anchorAt >= 2_000 ? PRO_SUB : FREE_SUB
      },
    })
    await bootBilling(page, '/settings/billing?upgraded=true', proIntent())

    await expect(page.getByText(/Finalizing your upgrade/i)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'B-degraded-endpoint-state.png'), fullPage: true })

    // A 404'd status check must not block or error the page — the existing
    // poll fallback still confirms once the subscription flips.
    await expect(page.getByText(/Upgrade complete/i)).toBeVisible({ timeout: 25_000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'B-degraded-endpoint-confirmed-anyway.png'), fullPage: true })
  })

  test('C — a pending (not yet returned) intent survives navigation and is offered by the watchdog', async ({ page }) => {
    const counters = await installMocks(page, { subForRequest: () => FREE_SUB })
    // No ?upgraded=true — this simulates a reload/tab-close BEFORE returning
    // from the hosted checkout. The intent (with the new paymentId field)
    // must still be there and offered.
    await bootBilling(page, '/settings/billing', proIntent())
    await expect(page.getByText(/didn.t complete checkout/i)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'C-pending-state.png'), fullPage: true })
    // Confirm the intent really did round-trip through real localStorage
    // (not just a mock) — the paymentId survives too.
    const raw = await page.evaluate(() => localStorage.getItem('bb_pending_checkout'))
    expect(raw).toContain(PAYMENT_ID)
    void counters
  })

  test('D — WS-reconnect catch-up re-checks when a pending intent exists (spec §3.3 item 3)', async ({ page }) => {
    const counters = await installMocks(page, { subForRequest: () => PRO_SUB })
    await bootBilling(page, '/settings/billing', proIntent())
    const before = counters.subscriptionGets
    // Simulate the socket coming back up — use-websocket.ts dispatches this
    // exact CustomEvent on `ws.onopen`. No real WS server exists in this
    // harness, so this is the only way to exercise the reconnect listener.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beebeeb:ws-connected')))
    await expect.poll(() => counters.subscriptionGets, { timeout: 10_000 }).toBeGreaterThan(before)
  })

  // PR #53 review (task 0957 follow-up): `reconcileOnSignal`'s clear/confirm
  // used to live inside `if (showUpgraded && ...)`. When the checkout return
  // URL loses `?upgraded=true` AND the payment only settles server-side
  // AFTER this tab's own 30s reconcile-on-load poll has already given up
  // (deadline reached, no more attempts scheduled), a WS reconnect was the
  // ONLY remaining signal that could catch it — and used to refresh the
  // subscription without ever resolving the intent, leaving the "didn't
  // complete checkout" watchdog stuck until the intent's 24h TTL even though
  // the payment had, in fact, completed.
  test('E — no ?upgraded flag: a payment that settles only AFTER the 30s poll gives up still resolves via WS-reconnect (no watchdog left stuck)', async ({ page }) => {
    let settled = false
    const counters = await installMocks(page, {
      // Endpoint absent/degraded (paymentStatus omitted → 404) — isolates
      // this test to the plain subscription-poll + WS-reconnect path the
      // finding is about, not the direct payment-status check.
      subForRequest: () => (settled ? PRO_SUB : FREE_SUB),
    })
    // No ?upgraded=true — the return flag was lost.
    await bootBilling(page, '/settings/billing', proIntent())

    // The watchdog offers to resume the abandoned-looking checkout while the
    // payment hasn't landed — same UX as scenario C, proving this setup is
    // real (not vacuously "nothing shows because nothing was pending").
    await expect(page.getByText(/didn.t complete checkout/i)).toBeVisible({ timeout: 15_000 })

    // Let the reconcile-on-load poll exhaust its OWN 30s deadline without
    // ever seeing the upgrade (subForRequest keeps returning FREE_SUB) —
    // this IS "settles after the 30s poll": nothing client-side is going to
    // confirm this on its own anymore.
    await page.waitForTimeout(32_000)
    const beforeReconnect = counters.subscriptionGets

    // NOW the payment settles server-side, and the socket reconnects — the
    // only remaining signal that could catch it.
    settled = true
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beebeeb:ws-connected')))

    // The WS-reconnect catch-up actually refetched...
    await expect.poll(() => counters.subscriptionGets, { timeout: 10_000 }).toBeGreaterThan(beforeReconnect)
    // ...and resolved the intent: cleared from the SAME localStorage record
    // the watchdog reads from...
    await expect.poll(
      () => page.evaluate(() => localStorage.getItem('bb_pending_checkout')),
      { timeout: 10_000 },
    ).toBeNull()
    // ...so the watchdog must be gone too — never left showing a false
    // "didn't complete checkout" under a subscription that has completed.
    await expect(page.getByText(/didn.t complete checkout/i)).not.toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'E-noflag-late-settle-resolved.png'), fullPage: true })
  })

  // ── Task 1469 — the two entry points 0957 missed ──────────────────────────
  // Both scenarios below: click the real DOM entry point with the checkout
  // redirect INTERCEPTED (mocked /billing/checkout + a mocked hosted-checkout
  // URL, same pattern as e2e/trial-0905.spec.ts GATE 3), confirm the browser
  // actually navigates there (proving the click really fired the redirect),
  // then navigate back to the app's own origin (mirrors returning from a real
  // hosted checkout — bb_pending_checkout lives in THAT origin's localStorage,
  // untouched by navigating away to the mocked checkout host) and assert the
  // intent a REAL click persisted, not a seeded fixture.

  test('F — pricing.tsx: the plan-purchase button persists a pre-checkout intent before the checkout redirect (task 1469)', async ({ page }) => {
    const CHECKOUT_URL = 'https://checkout.mollie.test/1469-pricing-mock'
    const counters = await installMocks(page, { subForRequest: () => FREE_SUB })
    await page.route('**/api/v1/billing/checkout', (route) => json(route, { url: CHECKOUT_URL, payment_id: PAYMENT_ID }))
    await page.route(CHECKOUT_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>mock checkout</body></html>' }),
    )

    await bootBilling(page, '/pricing')

    // pricing.tsx's `isLoggedIn = !!getToken()` reads the LEGACY localStorage
    // session slot (packages/shared/src/api/token.ts) — auth-context.tsx's
    // boot migrates it to the httpOnly cookie and calls `clearToken()` within
    // the same tick, so by the time ANY route renders, that slot is already
    // empty (pre-existing behavior, unrelated to task 1469 — see this file's
    // header comment / the task's Notes for the full finding). The REAL
    // session lives in the cookie the whole time (every mocked API call
    // above already succeeds under it) — only this UI-level "am I logged
    // in" read is stale. Re-seed it post-boot so `isLoggedIn` reflects the
    // (real, cookie-backed) logged-in state on the next render, same as it
    // would if a caller still explicitly held a bearer token.
    await page.evaluate(() => localStorage.setItem('bb_session', 'e2e-1469-reseeded-token'))
    // Force a re-render so `isLoggedIn` (recomputed fresh every render, not
    // memoized) picks up the reseeded value — also pins cycle to 'monthly'
    // for the pre-state assertion below.
    await page.getByRole('button', { name: 'Monthly' }).click()

    // pricing.tsx fetches its own Subscription on mount once isLoggedIn is
    // true (task 1469) — wait for BOTH /billing/subscription callers
    // (DriveDataProvider's own, already fired during boot + pricing.tsx's,
    // fired by the re-render above) before clicking, so the pre-state below
    // reflects the real subscription rather than racing the click.
    await expect.poll(() => counters.subscriptionGets, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    await page.waitForTimeout(300) // let the resolved fetch's setState flush

    // All three marketed non-Business cards render "Start 14-day trial" —
    // click the first (Starter). Which plan is irrelevant to what's under
    // test (setPendingCheckout firing before the redirect); the mocked
    // /billing/checkout returns the same shape regardless of plan.
    await page.getByRole('button', { name: /Start 14-day trial/i }).first().click()
    await page.waitForURL(CHECKOUT_URL, { timeout: 15_000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'F-pricing-redirect.png'), fullPage: true })

    // Return to the app origin — the click's localStorage write lives there.
    await page.goto(`${WEB}/pricing`)
    const raw = await page.evaluate(() => localStorage.getItem('bb_pending_checkout'))
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.kind).toBe('plan')
    expect(parsed.plan).toBe('starter')
    expect(parsed.cycle).toBe('monthly') // the Monthly toggle click above
    expect(parsed.paymentId).toBe(PAYMENT_ID)
    // A complete pre-state (every key makePreState reads) — the pre-1469 bug
    // persisted NOTHING at all (no bb_pending_checkout key whatsoever).
    expect(Object.keys(parsed.pre).sort()).toEqual(
      ['cycle', 'extraStorageTb', 'mandateMethod', 'periodEnd', 'plan', 'status', 'storageTbQuantity'].sort(),
    )
    // The real FREE_SUB the mock served — proves it's the fetched
    // subscription's actual field values, not a placeholder.
    expect(parsed.pre).toEqual({
      plan: 'free', cycle: 'monthly', status: 'active', periodEnd: null,
      extraStorageTb: 0, storageTbQuantity: 0, mandateMethod: null,
    })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'F-pricing-intent-persisted.png'), fullPage: true })
  })

  test('G — drive.tsx: the upgrade-nudge modal "Upgrade now" persists a pre-checkout intent before the checkout redirect (task 1469)', async ({ page }) => {
    const CHECKOUT_URL = 'https://checkout.mollie.test/1469-nudge-mock'
    await installMocks(page, { subForRequest: () => FREE_SUB })

    // Drive over-fetches beyond installMocks' reconcile-focused surface —
    // override/add the extra endpoints the drive page itself needs. A more
    // SPECIFIC page.route registered AFTER installMocks() takes priority
    // (Playwright resolves routes most-recently-registered-first).
    await page.route('**/api/v1/files/usage', (route) =>
      json(route, { used_bytes: 85_000_000_000, plan_limit_bytes: 100_000_000_000, plan_name: 'free' }),
    )
    await page.route('**/api/v1/billing/usage', (route) =>
      json(route, { used_bytes: 85_000_000_000, quota_bytes: 100_000_000_000, percentage: 85 }),
    )
    // Sync engine — empty snapshot + a token so SyncClient.start() resolves
    // cleanly instead of erroring (the modal doesn't depend on sync.ready,
    // but a clean snapshot keeps the page from spamming reconnect attempts).
    await page.route('**/api/v1/sync/snapshot', (route) => json(route, { seq_id: 0, nodes: [] }))
    await page.route('**/api/v1/sync/stream-token', (route) => json(route, { stream_token: 'mock-stream-token' }))
    await page.route('**/api/v1/sync/stream**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', headers: CORS, body: '' }),
    )
    await page.route('**/api/v1/billing/checkout', (route) => json(route, { url: CHECKOUT_URL, payment_id: PAYMENT_ID }))
    await page.route(CHECKOUT_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>mock checkout</body></html>' }),
    )

    await bootBilling(page, '/')
    // used_bytes/plan_limit_bytes = 85 000 000 000/100 000 000 000 = 85% —
    // over the 80% shouldShowUpgradeNudge threshold — the modal auto-opens.
    await expect(page.getByRole('dialog', { name: /Upgrade to Starter/i })).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'G-nudge-modal-shown.png'), fullPage: true })

    await page.getByRole('button', { name: /^Upgrade now$/i }).click()
    await page.waitForURL(CHECKOUT_URL, { timeout: 15_000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'G-nudge-redirect.png'), fullPage: true })

    // Return to the app origin — the click's localStorage write lives there.
    await page.goto(`${WEB}/`)
    const raw = await page.evaluate(() => localStorage.getItem('bb_pending_checkout'))
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.kind).toBe('plan')
    expect(parsed.plan).toBe('starter') // UPGRADE_CHAIN.free
    expect(parsed.cycle).toBe('yearly')
    expect(parsed.paymentId).toBe(PAYMENT_ID)
    expect(Object.keys(parsed.pre).sort()).toEqual(
      ['cycle', 'extraStorageTb', 'mandateMethod', 'periodEnd', 'plan', 'status', 'storageTbQuantity'].sort(),
    )
    expect(parsed.pre).toEqual({
      plan: 'free', cycle: 'monthly', status: 'active', periodEnd: null,
      extraStorageTb: 0, storageTbQuantity: 0, mandateMethod: null,
    })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'G-nudge-intent-persisted.png'), fullPage: true })
  })
})
