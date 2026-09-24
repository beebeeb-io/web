/**
 * 1517 — trial-already-used accounts could not upgrade at all.
 *
 * Web-app-only: NO server runs. Every API call is mocked with page.route
 * (same pattern as e2e/checkout-redirect-0865.spec.ts — the vault unlock uses
 * the REAL WASM crypto path via the mocked /dev/auto-login → DevAuthGate).
 *
 * Reported (prod, Guus, iPhone Safari): a Free-plan account with
 * `users.has_used_trial = true` (trial used in July) saw "Start 14-day Pro
 * trial" / "Start 14-day Basic trial" CTAs AND the Compare-plans table's
 * "Upgrade" buttons — clicking ANY of them tried to start a trial first,
 * hit the server's one-trial-per-account 409, and showed a toast with the
 * RAW JSON error body as its description. No path reached paid checkout.
 *
 * GATE 1 — a `has_used_trial: true` subscription shows NO trial CTA anywhere
 *   (current-plan card, subtext, Compare-plans table): every entry point
 *   goes straight to the paid UpgradeDialog, and `POST /billing/trial/start`
 *   is NEVER called.
 * GATE 2 — even if a stale/racy trial attempt still happens (has_used_trial
 *   was false client-side, server says otherwise), the double-JSON-encoded
 *   409 body from the real server code path never leaks into the toast —
 *   only the clean, honest message.
 *
 * Run: bunx playwright test --config=e2e/1517-trial-used-upgrade.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

const FREE_SUB_TRIAL_USED = {
  plan: 'free',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: null,
  pending_downgrade_plan: null,
  has_used_trial: true,
  can_upgrade: true,
}

const FREE_SUB_TRIAL_UNUSED = {
  ...FREE_SUB_TRIAL_USED,
  has_used_trial: false,
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
    id: 'pro', name: 'Pro', price_eur: 9.99, price_yearly_eur: 99,
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

interface MockOpts {
  sub: unknown
  /** When set, POST /billing/trial/start returns this instead of succeeding. */
  trialStartResponse?: { status: number; body: unknown }
}

function installMocks(page: Page, opts: MockOpts) {
  const counters = { trialStartPosts: 0, checkoutPosts: 0 }

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

    if (url.includes('/billing/subscription')) return json(route, opts.sub)
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
    if (url.includes('/billing/checkout')) {
      counters.checkoutPosts += 1
      return json(route, { url: 'https://www.mollie.com/checkout/mock-session' })
    }
    if (url.includes('/billing/trial/start')) {
      counters.trialStartPosts += 1
      if (opts.trialStartResponse) {
        return json(route, opts.trialStartResponse.body, opts.trialStartResponse.status)
      }
      // Should never be reached by GATE 1 — fail loudly if it is.
      return json(route, { error: 'unexpected_trial_start_call' }, 500)
    }

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

test.describe('1517 — trial-already-used accounts can upgrade', () => {
  test('GATE 1a — has_used_trial:true hides the trial CTA on the current-plan card', async ({ page }) => {
    await installMocks(page, { sub: FREE_SUB_TRIAL_USED })
    await bootBilling(page, '/settings/billing?view=change')

    // The trial CTAs must be entirely absent.
    await expect(page.getByRole('button', { name: /Start 14-day Pro trial/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Start 14-day Basic trial/i })).toHaveCount(0)
    await expect(page.getByText(/14 days free\. No card required/i)).toHaveCount(0)

    // The paid-upgrade CTAs must be visible instead.
    await expect(page.getByRole('button', { name: /Upgrade to Basic/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /Explore Pro/i })).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/1517-gate1a-no-trial-cta.png', fullPage: true })
  })

  test('GATE 1b — clicking Upgrade goes straight to paid checkout, never calls trial/start', async ({ page }) => {
    const counters = await installMocks(page, { sub: FREE_SUB_TRIAL_USED })
    await bootBilling(page, '/settings/billing?view=change')

    await page.getByRole('button', { name: /Upgrade to Basic/i }).click()

    // The paid UpgradeDialog opens (its own "Continue"/cycle-selector chrome).
    await expect(page.getByText(/Basic/i).first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/1517-gate1b-upgrade-dialog-opens.png', fullPage: true })

    expect(counters.trialStartPosts).toBe(0)
  })

  test('GATE 1c — Compare-plans table "Upgrade" buttons also skip the trial for a used account', async ({ page }) => {
    const counters = await installMocks(page, { sub: FREE_SUB_TRIAL_USED })
    await bootBilling(page, '/settings/billing?view=change')

    const upgradeButtons = page.getByRole('button', { name: /^Upgrade$/ })
    await expect(upgradeButtons.first()).toBeVisible({ timeout: 15_000 })
    await upgradeButtons.first().click()

    // Should open the paid dialog directly — no trial attempt, no
    // "already used your free trial" toast.
    await expect(page.getByText(/could not start your trial/i)).toHaveCount(0)
    await page.screenshot({ path: 'e2e/screenshots/1517-gate1c-compare-table-upgrade.png', fullPage: true })

    expect(counters.trialStartPosts).toBe(0)
  })

  test('GATE 2 — a stale/racy trial attempt never shows the raw double-encoded JSON body', async ({ page }) => {
    // Simulate has_used_trial being (incorrectly) false client-side while the
    // server still rejects — the EXACT double-encoded body captured from
    // repos/server/beebeeb-api/src/error.rs's generic Conflict render path
    // (ApiError::Conflict(json!({...}).to_string()) double-wrapped).
    await installMocks(page, {
      sub: FREE_SUB_TRIAL_UNUSED,
      trialStartResponse: {
        status: 409,
        body: {
          error:
            '{"error":"trial_already_used","message":"You have already used your free trial on this account."}',
        },
      },
    })
    await bootBilling(page, '/settings/billing?view=change')

    await page.getByRole('button', { name: /Start 14-day Pro trial/i }).click()

    // The clean, mapped message must appear...
    await expect(page.getByText(/already used your free trial/i)).toBeVisible({ timeout: 15_000 })
    // ...and the raw JSON blob must NEVER appear anywhere on the page.
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('{"error"')
    expect(bodyText).not.toContain('\\"message\\"')

    await page.screenshot({ path: 'e2e/screenshots/1517-gate2-clean-toast-not-raw-json.png', fullPage: true })
  })
})
