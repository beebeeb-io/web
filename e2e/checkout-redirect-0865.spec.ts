/**
 * 0865 — web checkout/portal-initiate redirect swap — verification spec.
 *
 * Web-app-only: NO server runs. Every API call is mocked with page.route, and
 * the vault unlock uses the REAL WASM crypto path (32 random master-key bytes
 * returned by the mocked /dev/auto-login → cacheVaultKey via DevAuthGate).
 *
 * Gates (task file §"Verification gates"):
 *   1. return-param survival: /billing?upgraded=true → /settings/billing keeps it
 *   3. poll-confirmed success: Finalizing → Upgrade complete after N polls
 *   4. cancel/unchanged: neutral "Payment processing", not a false success
 *   5. watchdog: bb_pending_checkout re-offer + clears on ?upgraded
 *   6. copy audit: no user-visible "Stripe" on the checkout path
 *
 * Run: bunx playwright test --config=e2e/checkout-redirect-0865.config.ts
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

const PRO_SUB = {
  plan: 'pro',
  billing_cycle: 'yearly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: '2027-06-25T00:00:00Z',
  pending_downgrade_plan: null,
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

/**
 * Install the full mock backend. `subForRequest` lets a test return different
 * subscription payloads over successive GET /billing/subscription calls (so the
 * poll can flip from free → pro after N attempts). Returns a counter object so
 * tests can assert the number of subscription polls.
 */
function installMocks(
  page: Page,
  opts: { subForRequest?: (n: number) => unknown } = {},
) {
  const counters = { subscriptionGets: 0, checkoutPosts: 0, lastCheckoutBody: null as unknown }

  return page.route('**/*', async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    // Only intercept API + dev-auth traffic; let the Vite app assets load.
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

    // ── dev auto-login → real WASM unlock with 32 random bytes ──
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

    // ── billing ──
    if (url.includes('/billing/subscription')) {
      const n = counters.subscriptionGets
      counters.subscriptionGets += 1
      const body = opts.subForRequest ? opts.subForRequest(n) : FREE_SUB
      return json(route, body)
    }
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
    if (url.includes('/billing/checkout')) {
      counters.checkoutPosts += 1
      counters.lastCheckoutBody = JSON.parse(route.request().postData() ?? '{}')
      return json(route, { url: 'https://www.mollie.com/checkout/mock-session' })
    }
    // Task 1064 (D5): a Free-plan trial-eligible user's comparison-table/CTA
    // clicks now start a TRIAL, not checkout — so GATE 6 (which audits the
    // UpgradeDialog's copy) mocks trial/start as already-exhausted (409
    // trial_already_used), the real server response for a user who used their
    // trial. That flips billing.tsx's `trialUsed` and falls back to
    // `openUpgrade`, reaching the same dialog this test asserts on.
    if (url.includes('/billing/trial/start')) {
      return json(route, { error: 'trial_already_used' }, 409)
    }

    // ── drive / preferences (loadData side-fetches) ──
    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })

    // Default: empty 200 so nothing throws.
    return json(route, {})
  }).then(() => counters)
}

/** Boot the app at a billing URL with the vault unlocked, suppressing overlays. */
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

test.describe('0865 checkout redirect + poll-confirmed success', () => {
  test('GATE 1 — return-param survives /billing → /settings/billing redirect', async ({ page }) => {
    await installMocks(page, { subForRequest: () => FREE_SUB })
    await bootBilling(page, '/billing?upgraded=true')
    // The /billing route is a redirect; assert it lands on /settings/billing
    // WITH ?upgraded=true preserved (the load-bearing react-router v7 bug).
    await page.waitForURL(/\/settings\/billing\?upgraded=true/, { timeout: 15_000 })
    expect(new URL(page.url()).searchParams.get('upgraded')).toBe('true')
    // The finalize/poll card must render (proves showUpgraded fired).
    await expect(page.getByText(/Finalizing your upgrade|Upgrade complete/i)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/0865-gate1-param-survival.png', fullPage: true })
  })

  test('GATE 3 — poll-confirmed success flips Finalizing → Upgrade complete', async ({ page }) => {
    // First 2 polls return free (still provisioning), then pro (webhook landed).
    // Poll #0 is the initial loadData() fetch; flip on the 3rd subscription GET.
    await installMocks(page, { subForRequest: (n) => (n >= 3 ? PRO_SUB : FREE_SUB) })
    await bootBilling(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/Finalizing your upgrade/i)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/0865-gate3-finalizing.png', fullPage: true })
    await expect(page.getByText(/Upgrade complete/i)).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText(/Welcome to Pro/i)).toBeVisible({ timeout: 5_000 })
    await page.screenshot({ path: 'e2e/screenshots/0865-gate3-complete.png', fullPage: true })
  })

  test('GATE 4 — unchanged subscription past timeout → neutral, not a false success', async ({ page }) => {
    // Subscription never changes (cancelled/expired/never-paid). The poll window
    // must elapse to the neutral "Payment processing" state — no false success.
    await installMocks(page, { subForRequest: () => FREE_SUB })
    await bootBilling(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/Finalizing your upgrade/i)).toBeVisible({ timeout: 15_000 })
    // Wait out the ~30s poll cap → neutral "still processing" message. Copy was
    // softened in task 0943 so it never implies failure (a deferred-SEPA charge
    // is indistinguishable from a slow webhook on the redirect return).
    await expect(page.getByText(/Still processing/i)).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/still settling with our processor/i)).toBeVisible()
    // Must NOT claim success.
    await expect(page.getByText(/Upgrade complete/i)).toHaveCount(0)
    await page.screenshot({ path: 'e2e/screenshots/0865-gate4-unconfirmed.png', fullPage: true })
  })

  test('GATE 5 — watchdog re-offers pending checkout, clears on ?upgraded', async ({ page }) => {
    await installMocks(page, { subForRequest: () => FREE_SUB })
    // Seed an abandoned checkout (set just before a redirect that never returned).
    await page.addInitScript(() => {
      localStorage.setItem(
        'bb_pending_checkout',
        JSON.stringify({ plan: 'pro', cycle: 'yearly', ts: Date.now() }),
      )
    })
    // Return WITHOUT ?upgraded → watchdog "Continue" banner is offered.
    await bootBilling(page, '/settings/billing')
    await expect(page.getByText(/didn.t complete checkout/i)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/0865-gate5-watchdog-offer.png', fullPage: true })
    // Now return WITH ?upgraded=true → watchdog clears (banner gone).
    await bootBilling(page, '/settings/billing?upgraded=true')
    await expect(page.getByText(/didn.t complete checkout/i)).toHaveCount(0, { timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/0865-gate5-watchdog-cleared.png', fullPage: true })
  })

  test('GATE 6 — copy audit: no user-visible Stripe on checkout path, single amber, no emoji', async ({ page }) => {
    await installMocks(page, { subForRequest: () => FREE_SUB })
    await bootBilling(page, '/settings/billing')
    // The upgrade CTA lives on the "change" view (post-0942 summary/change
    // split — "Choose a plan" opens it), not the /settings/billing summary.
    await page.getByRole('button', { name: /Choose a plan/i }).click()
    await expect(page.getByText(/Plan & billing/i).first()).toBeVisible({ timeout: 15_000 })
    // Open the upgrade dialog (the checkout entry point that holds the copy).
    // Task 1064 (D5): a trial-eligible Free user's CTAs now start a TRIAL, not
    // checkout, so this clicks "Start 14-day Pro trial" — mocked above to 409
    // trial_already_used, which billing.tsx falls back to `openUpgrade` for
    // (the real behavior for a user who already used their trial).
    await page.getByRole('button', { name: /Start 14-day Pro trial/i }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
    // The dialog opens on the billing-cycle step; "Continue" advances to
    // BillingInfoStep, which holds the "Choose your payment method on the
    // next step" copy this gate audits.
    await page.getByRole('button', { name: /^Continue$/i }).click()
    await expect(page.getByText(/Choose your payment method on the next step/i)).toBeVisible({ timeout: 10_000 })
    // No enumerated method list, no "Stripe", no emoji in the dialog.
    const dialogText = (await page.getByRole('dialog').textContent()) ?? ''
    expect(dialogText).not.toMatch(/Stripe/i)
    expect(dialogText).not.toMatch(/Apple Pay|iDEAL|SEPA/i)
    // Emoji range check (no pictographic emoji in the dialog copy).
    expect(dialogText).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    await page.screenshot({ path: 'e2e/screenshots/0865-gate6-copy-audit.png', fullPage: true })
  })
})
