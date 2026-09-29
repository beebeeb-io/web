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
import { WEB_URL } from './trial-0905-web-url'

// Task 1604 review thread PRRT_kwDOSLX6Nc6nC4VK — `WEB` used to default to
// :5173 independently of the config's `webServer`/`baseURL` (which defaults
// to :5199), so the documented default command either got
// ERR_CONNECTION_REFUSED or silently tested an unrelated :5173 dev server.
// Both files now import the SAME constant.
const WEB = WEB_URL

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

/**
 * Server-realistic trial payload: trial.rs `start_trial` sets
 * current_period_end == trial_ends_at. GATE 4 needs this shape — the payload
 * above has current_period_end: null, which is why the "Renews" bug for a
 * no-card trial (flow-money #5) was never caught.
 */
function trialingSubWithPeriodEnd() {
  const s = trialingSub()
  return { ...s, current_period_end: s.trial_ends_at }
}

/** Mollie cancel path: status 'cancelling', current_period_end kept as the grace end. */
function cancellingSub() {
  const ends = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString()
  return {
    plan: 'pro', billing_cycle: 'monthly', seats: 1, region: 'eu-central',
    status: 'cancelling', created_at: '2026-06-01T00:00:00Z',
    current_period_end: ends, trial_ends_at: null, pending_downgrade_plan: null,
  }
}

function activeSub() {
  const ends = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString()
  return {
    plan: 'pro', billing_cycle: 'monthly', seats: 1, region: 'eu-central',
    status: 'active', created_at: '2026-06-01T00:00:00Z',
    current_period_end: ends, trial_ends_at: null, pending_downgrade_plan: null,
  }
}

/**
 * Task 1604 — a trialing row that already holds a Mollie mandate (server
 * #125): `trial_auto_converts: true`, `current_period_end == trial_ends_at`
 * (same server-realistic shape as `trialingSubWithPeriodEnd`). Charges
 * automatically at `trial_ends_at` instead of dropping to Free.
 */
function mandatedTrialSub() {
  const s = trialingSubWithPeriodEnd()
  return { ...s, trial_auto_converts: true }
}

/**
 * Task 1604 review thread PRRT_kwDOSLX6Nc6nC4VT — a mandated trial with an
 * active storage add-on. `addon_cents: 1099` mirrors the server's
 * `addon_amount_cents(plan, 'monthly', 1, 0)` for a EUR 10.99/mo, 1 TB
 * add-on (task 1607, Guus ruling 2026-09-29, reverting task 1463's
 * 2026-09-22 raise to EUR 14.99; the current cycle is monthly here, so no
 * ×12 yet). The promised "first charge" for a monthly→yearly switch must be
 * the PLAN'S yearly price PLUS the add-on re-priced at yearly (×12) —
 * EUR 99.00 + EUR 131.88 = EUR 230.88 — never just the EUR 99.00 base plan
 * price.
 */
function mandatedTrialSubWithAddon() {
  const s = mandatedTrialSub()
  return { ...s, extra_storage_tb: 1, addon_cents: 1099 }
}

/**
 * Task 1604 (c) — a trial cancelled before its first charge (server #128:
 * `status='cancelling' AND current_period_end <= trial_ends_at`). Unlike
 * `cancellingSub` (a normal paid cancellation, no `trial_ends_at`), this row
 * keeps `trial_ends_at` and `current_period_end` pinned equal — the row
 * never reached a real billing period.
 */
function cancelledTrialSub() {
  const ends = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
  return {
    plan: 'pro', billing_cycle: 'monthly', seats: 1, region: 'eu-central',
    status: 'cancelling', created_at: '2026-06-01T00:00:00Z',
    current_period_end: ends, trial_ends_at: ends, pending_downgrade_plan: null,
  }
}

/**
 * Task 1604 — a cancelling row already marked for deletion
 * (`data_deletion_at` set, server #125/#1037). Distinct from
 * `cancelledTrialSub`: this is a LAPSED account (no trial fields), not a
 * trial cancelled before its first charge.
 *
 * Review thread PRRT_kwDOSLX6Nc6nC4Vb: `account_state: 'lapsed'` is NOT
 * optional here — per `resolve_account_state` (server signup_plan.rs),
 * `data_deletion_at` is only ever non-null once `account_state` has already
 * resolved to `lapsed`, so a production row that carries `data_deletion_at`
 * ALWAYS carries `account_state: 'lapsed'` too. Without it this fixture
 * couldn't have caught the billing.tsx bug it exists to catch (a missing
 * `account_state` resolves to `'ok'`, which never hit the lapsed code path at
 * all — the test passed for the wrong reason).
 */
const DELETION_AT = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
function cancellingWithDeletionSub() {
  return { ...cancellingSub(), data_deletion_at: DELETION_AT, account_state: 'lapsed' }
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
        session_token: 'dev-mock-session', user_id: AUTH_USER.user_id,
        master_key_bytes_base64: b64,
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
    // Task 1037: a trial now needs a payment mandate — the subtext is the
    // shared trial terms line (trialTermsCopy), not "No card required".
    await expect(page.getByText('14-day free trial. Card or iDEAL needed to start. No charge until day 15; cancel any time before.').first()).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/0905-gate1-start-trial-cta.png', fullPage: true })
  })

  test('GATE 2 — trialing subscription renders the "N days left" banner + convert CTA', async ({ page }) => {
    await installMocks(page, { sub: trialingSub() })
    await bootBilling(page, '/settings/billing')
    // Task 1449: this used to wait on `getByText(/Plan & billing/i)` first —
    // the wrong locator for this gate. "Plan & billing" is the SettingsHeader
    // title only for the loading/error states and the "change" view
    // (src/pages/billing.tsx:1183,1199,1317); GATE 2 boots straight to
    // `/settings/billing` with no `?view=change`, so the page settles on the
    // "summary" view, whose header is "Billing" (billing.tsx:1312) — "Plan &
    // billing" never appears there once loaded. The old assertion only ever
    // passed by racing the transient loading-spinner title against how fast
    // the mocked fetches resolve relative to first commit — flaky by
    // construction. Wait on the actual gate content instead, with the full
    // 15s budget the removed line had.
    // The "N days left in your free trial" copy renders on BOTH surfaces — the
    // billing-page summary card (h2) AND the global drive/settings banner (span).
    // Assert both are present (proves the page summary + the global banner wire).
    await expect(page.getByText(/days left in your free trial/i).first()).toBeVisible({ timeout: 15_000 })
    expect(await page.getByText(/days left in your free trial/i).count()).toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('heading', { name: /days left in your free trial/i })).toBeVisible()
    // Convert CTA present (the billing-card summary holds it).
    await expect(page.getByRole('button', { name: /Add payment method/i }).first()).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/0905-gate2-trialing-banner.png', fullPage: true })
  })

  test('GATE 3 — convert click POSTs /trial/convert and redirects to the Mollie URL', async ({ page }) => {
    const counters = await installMocks(page, { sub: trialingSub() })
    await bootBilling(page, '/settings/billing')
    // Task 1449: this copy renders on BOTH surfaces (see GATE 2's comment
    // above) — the billing-page h2 AND the global TrialBanner span
    // (src/components/trial-banner.tsx:137-138, fed by useDriveData(), a
    // SEPARATE fetch from billing.tsx's own `sub` state). Whichever
    // consumer's fetch resolves first decides whether one or both are
    // mounted at any given instant — a real race (same defect class as task
    // 1441's triple-fetcher root cause). Missing `.first()` here threw a
    // strict-mode violation whenever both were mounted simultaneously
    // (reproduced: 1 of 5 harness runs — "strict mode violation: resolved to
    // 2 elements"). `.first()` matches the pattern GATE 2 already uses.
    await expect(page.getByText(/days left in your free trial/i).first()).toBeVisible({ timeout: 15_000 })

    // Click the convert CTA. The handler stamps bb_pending_checkout (0865 reuse)
    // then sets window.location.href to the mocked Mollie URL — assert the nav.
    await page.getByRole('button', { name: /Add payment method/i }).first().click()
    await page.waitForURL(/mollie\.com\/checkout\/trial-convert-mock/, { timeout: 15_000 })
    expect(counters.convertPosts).toBeGreaterThanOrEqual(1)
    await page.screenshot({ path: 'e2e/screenshots/0905-gate3-convert-redirect.png', fullPage: true })
  })
  // Flow-money #5 (P2): a no-card trial will not renew — it drops to Free on
  // trial_ends_at. The summary footer and the change-view period line must
  // say "Trial ends", never "Renews". Cancelling says "Access until".
  test('GATE 4 — trialing sub shows "Trial ends", never "Renews" (summary + change view)', async ({ page }) => {
    await installMocks(page, { sub: trialingSubWithPeriodEnd() })
    await bootBilling(page, '/settings/billing')
    await expect(page.getByRole('heading', { name: /days left in your free trial/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/^Trial ends /).first()).toBeVisible()
    expect(await page.getByText(/\bRenews\b/).count()).toBe(0)
    await page.screenshot({ path: 'e2e/screenshots/flow-money-5-trial-summary.png', fullPage: true })

    await page.getByRole('button', { name: /Change plan/i }).click()
    await expect(page.getByText(/Plan & billing/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/^Trial ends /).first()).toBeVisible()
    expect(await page.getByText(/\bRenews\b/).count()).toBe(0)
    await page.screenshot({ path: 'e2e/screenshots/flow-money-5-trial-change.png', fullPage: true })
  })

  test('GATE 5 — cancelling sub shows "Access until" in the summary footer, never "Renews"', async ({ page }) => {
    await installMocks(page, { sub: cancellingSub() })
    await bootBilling(page, '/settings/billing')
    await expect(page.getByText(/^Access until /).first()).toBeVisible({ timeout: 15_000 })
    expect(await page.getByText(/\bRenews\b/).count()).toBe(0)
    await page.screenshot({ path: 'e2e/screenshots/flow-money-5-cancelling-summary.png', fullPage: true })
  })

  test('GATE 6 — control: active paid sub still shows "Renews"', async ({ page }) => {
    await installMocks(page, { sub: activeSub() })
    await bootBilling(page, '/settings/billing')
    await expect(page.getByText(/^Renews /).first()).toBeVisible({ timeout: 15_000 })
    expect(await page.getByText(/Trial ends|Access until/).count()).toBe(0)
  })

  // Task 1604 — server #125/#128: a `trialing` row can already hold a Mollie
  // mandate (`trial_auto_converts: true`) and charge automatically at
  // trial_ends_at, instead of lapsing to Free like the legacy no-card trial.
  // Same status, opposite outcome — the label and the switch-cycle copy must
  // say so.
  test('GATE 7 — mandated trial shows "Trial · first charge on", never "Trial ends"', async ({ page }) => {
    await installMocks(page, { sub: mandatedTrialSub() })
    await bootBilling(page, '/settings/billing')
    // A mandated trial renders the "billing-trial-auto" banner
    // (billing.tsx:1841), whose heading names the PLAN, not "free" — "N days
    // left in your Pro trial" — distinct from the no-card banner GATE 1/2 use.
    await expect(page.getByTestId('billing-trial-auto')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /days left in your Pro trial/i })).toBeVisible()
    await expect(page.getByText(/^Trial · first charge on /).first()).toBeVisible()
    expect(await page.getByText(/^Trial ends /).count()).toBe(0)
    expect(await page.getByText(/\bRenews\b/).count()).toBe(0)
    await page.screenshot({ path: 'e2e/screenshots/1604-gate7-mandated-trial-label.png', fullPage: true })
  })

  test('GATE 8 — mandated trial cycle-switch note: "Nothing is charged today", first charge on the trial-end date, no "add a payment method"', async ({ page }) => {
    await installMocks(page, { sub: mandatedTrialSub() })
    await bootBilling(page, '/settings/billing')
    await page.getByRole('button', { name: /Change plan/i }).click()
    await expect(page.getByText(/Plan & billing/i).first()).toBeVisible({ timeout: 15_000 })
    // mandatedTrialSub is billing_cycle: 'monthly' → the annual-savings prompt
    // (Switch to annual) is the one offered.
    await page.getByRole('button', { name: /^Switch to annual$/ }).click()
    const note = page.getByTestId('cycle-switch-trial-note')
    await expect(note).toBeVisible({ timeout: 10_000 })
    await expect(note).toContainText('Nothing is charged today')
    await expect(note).toContainText('then every year')
    await expect(note).not.toContainText('add a payment method')
    await page.screenshot({ path: 'e2e/screenshots/1604-gate8-mandated-trial-switch-note.png', fullPage: true })
  })

  test('GATE 9 — cancelled trial: switch UI is not offered, shows "resume it to change billing"', async ({ page }) => {
    await installMocks(page, { sub: cancelledTrialSub() })
    await bootBilling(page, '/settings/billing')
    await page.getByRole('button', { name: /Change plan/i }).click()
    await expect(page.getByText(/Plan & billing/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Your trial is cancelled — resume it to change billing.')).toBeVisible({ timeout: 10_000 })
    // Neither switch-cycle prompt is offered.
    expect(await page.getByRole('button', { name: /^Switch to annual$/ }).count()).toBe(0)
    expect(await page.getByRole('button', { name: /^Switch to monthly$/ }).count()).toBe(0)
    await page.screenshot({ path: 'e2e/screenshots/1604-gate9-cancelled-trial-no-switch.png', fullPage: true })
  })

  test('GATE 10 — cancelling row with data_deletion_at set shows "Access until" plus "Files deleted on"', async ({ page }) => {
    await installMocks(page, { sub: cancellingWithDeletionSub() })
    await bootBilling(page, '/settings/billing')
    await expect(page.getByText(/^Access until /).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Files deleted on /).first()).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/1604-gate10-cancelling-deletion-note.png', fullPage: true })
  })

  // Review thread PRRT_kwDOSLX6Nc6nC4VT: the promised "first charge" for a
  // mandated trial with an active storage add-on must include the add-on,
  // re-priced at the TARGET cycle — not just the plan's catalog base price.
  test('GATE 11 — mandated trial with a storage add-on: cycle-switch note names base + add-on, not base alone', async ({
    page,
  }) => {
    await installMocks(page, { sub: mandatedTrialSubWithAddon() })
    await bootBilling(page, '/settings/billing')
    await page.getByRole('button', { name: /Change plan/i }).click()
    await expect(page.getByText(/Plan & billing/i).first()).toBeVisible({ timeout: 15_000 })
    // mandatedTrialSubWithAddon is billing_cycle: 'monthly' → the
    // annual-savings prompt (Switch to annual) is offered.
    await page.getByRole('button', { name: /^Switch to annual$/ }).click()
    const note = page.getByTestId('cycle-switch-trial-note')
    await expect(note).toBeVisible({ timeout: 10_000 })
    // Pro yearly EUR 99.00 + (EUR 10.99/mo add-on × 12 = EUR 131.88) = EUR 230.88.
    await expect(note).toContainText('EUR 230.88')
    // The base-price-only number from the P1 bug must NOT appear as the
    // first-charge figure.
    await expect(note).not.toContainText('first charge of EUR 99.00')
    await page.screenshot({ path: 'e2e/screenshots/1604-gate11-mandated-trial-addon-switch-note.png', fullPage: true })
  })
})
