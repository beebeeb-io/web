/**
 * 1520 — [LAUNCH BLOCKER] /signup hard-coded a mandatory "Pilot access key"
 * field even after the server's pilot gate went OFF at launch
 * (BB_REQUIRE_PILOT_KEY=0 on both prod nodes, phase 2). Nobody could sign up
 * through the web client.
 *
 * Web-app-only: NO real server runs. Every API call is mocked with
 * page.route (same pattern as e2e/1517-trial-used-upgrade.spec.ts) —
 * everything else (recovery-phrase generation, the OPAQUE registration
 * start, X25519 derivation) is REAL client-side crypto via the committed
 * beebeeb-wasm build; only the network calls are faked.
 *
 * `?nodev=1` disables DevAuthGate's dev-auto-login fetch (src/lib/dev-auth.ts)
 * so /signup and /onboarding — both GuestRoute — never get auto-authenticated
 * out from under the test.
 *
 * GATE (a) — a fresh /signup visit shows NO pilot-key field, no pilot-gate
 *   notice, and submitting email + consent alone navigates straight to
 *   /onboarding carrying ONLY the email (no pilotKey at all).
 * GATE (b) — if the server ever DOES reject a keyless register-start with
 *   403 pilot_key_required (gate rolled back on), onboarding.tsx's catch
 *   handler bounces back to /signup with the field now visible, required,
 *   and showing the server's error inline — the safety net described in
 *   src/lib/signup-pilot-gate.ts.
 *
 * Run: bunx playwright test --config=e2e/1520-signup-no-pilot-key.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5199'

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
  /** When set, POST /api/v1/opaque/register-start returns this instead of succeeding. */
  registerStartResponse?: { status: number; body: unknown }
}

function installMocks(page: Page, opts: MockOpts = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = []

  const routePromise = page.route('**/*', async (route) => {
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

    // Never let a genuinely unmocked call slip through — this test never
    // starts a real server, and the app's VITE_API_URL is pinned off-prod
    // (see the config's webServer env) so an unmocked call fails locally
    // rather than silently reaching a real origin.
    calls.push({ url, headers: (route.request().headers() as Record<string, string>) ?? {} })

    // Anonymous visitor — /signup and /onboarding are GuestRoute, so a 401
    // here must NOT redirect anywhere (GuestRoute only redirects when BOTH
    // a user AND an unlocked vault are present).
    if (url.includes('/api/v1/auth/me')) return json(route, { error: 'unauthorized' }, 401)

    if (url.includes('/api/v1/opaque/register-start')) {
      if (opts.registerStartResponse) {
        return json(route, opts.registerStartResponse.body, opts.registerStartResponse.status)
      }
      // GATE (a) never submits a password, so register-start should never
      // actually be called in that test — fail loudly if it is.
      return json(route, { error: 'unexpected_register_start_call' }, 500)
    }

    return json(route, {}, 404)
  })

  return routePromise.then(() => calls)
}

async function bootSignup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
  })
  // ?nodev=1 — see file header. Persists in sessionStorage for the rest of
  // this browser context, so the later /onboarding navigation stays clean too.
  await page.goto(`${WEB}/signup?nodev=1`)
  await expect(page).toHaveURL(/\/signup/)
}

test.describe('1520 — /signup no longer hard-requires a pilot access key', () => {
  test('GATE (a) — fresh visit: no pilot field, no pilot copy, submit with email only proceeds to onboarding', async ({
    page,
  }) => {
    await installMocks(page)
    await bootSignup(page)

    // No pilot-key field or pilot-gate copy anywhere on a fresh visit.
    await expect(page.getByTestId('pilot-key-input')).toHaveCount(0)
    await expect(page.getByText(/pilot access key/i)).toHaveCount(0)
    await expect(page.getByText(/private development/i)).toHaveCount(0)

    await page.screenshot({ path: 'e2e/screenshots/1520-gate-a-no-pilot-field.png', fullPage: true })

    await page.getByLabel(/email/i).fill('launch-day@beebeeb.io')
    await page
      .getByRole('checkbox', { name: /Beebeeb cannot recover/i })
      .click()

    const continueButton = page.getByRole('button', { name: /^continue$/i })
    await expect(continueButton).toBeEnabled()
    await continueButton.click()

    // Proceeds straight to onboarding — no round trip through a pilot-key step.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
    await expect(page.getByText(/your master key, in words/i)).toBeVisible({ timeout: 15_000 })

    await page.screenshot({ path: 'e2e/screenshots/1520-gate-a-reached-onboarding.png', fullPage: true })
  })

  test('GATE (b) — a real 403 pilot_key_required bounces back to /signup with the field + error', async ({
    page,
  }) => {
    // Real server copy (repos/server/beebeeb-api/src/error.rs,
    // ApiError::PilotKeyRequired) — identical whether the key was missing or
    // wrong, since pilot_gate::evaluate doesn't distinguish the two.
    const PILOT_ERROR_MESSAGE =
      "Beebeeb is in private development. A pilot access key is required to sign up — contact the team if you're a pilot."
    await installMocks(page, {
      registerStartResponse: {
        status: 403,
        body: { error: 'pilot_key_required', message: PILOT_ERROR_MESSAGE },
      },
    })
    await bootSignup(page)

    // Still no field on the fresh visit.
    await expect(page.getByTestId('pilot-key-input')).toHaveCount(0)

    await page.getByLabel(/email/i).fill('gate-rollback@beebeeb.io')
    await page.getByRole('checkbox', { name: /Beebeeb cannot recover/i }).click()
    await page.getByRole('button', { name: /^continue$/i }).click()

    // Recovery phrase step.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
    const wordEls = page.locator('span.font-mono.text-sm.font-medium')
    await expect(wordEls).toHaveCount(12, { timeout: 15_000 })
    const phraseWords = (await wordEls.allInnerTexts()).map((w) => w.trim())

    await page.getByRole('checkbox', { name: /I've saved my recovery phrase offline/i }).click()
    await page.getByRole('button', { name: /I saved it/i }).click()

    // Verify step — retype the requested words.
    const verifyLabels = page.locator('label', { hasText: /^Word #\d+$/ })
    const labelCount = await verifyLabels.count()
    expect(labelCount).toBeGreaterThan(0)
    for (let i = 0; i < labelCount; i++) {
      const labelText = (await verifyLabels.nth(i).innerText()).trim()
      const m = labelText.match(/Word #(\d+)/)
      if (!m) throw new Error(`unexpected verify label: ${labelText}`)
      const wordIdx = parseInt(m[1], 10) - 1
      await page.getByLabel(labelText, { exact: true }).fill(phraseWords[wordIdx])
    }
    await page.getByRole('button', { name: /^verify$/i }).click()

    // Password step.
    const passwordField = page.getByPlaceholder('At least 12 characters')
    await expect(passwordField).toBeVisible({ timeout: 5_000 })
    await passwordField.fill('CorrectHorseBattery9!')
    await page.getByPlaceholder('Type it again').fill('CorrectHorseBattery9!')
    await page.getByRole('button', { name: /create account/i }).click()

    // register-start 403s → onboarding.tsx bounces back to /signup with the
    // field now visible, required, and showing the server's message inline.
    await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 })
    const pilotField = page.getByTestId('pilot-key-input')
    await expect(pilotField).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/pilot access key/i).first()).toBeVisible()
    const pilotError = pilotField.locator('xpath=../../p')
    await expect(pilotError).toBeVisible()
    await expect(pilotError).toHaveText(new RegExp(PILOT_ERROR_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

    // Email is preserved across the bounce.
    await expect(page.getByLabel(/email/i)).toHaveValue('gate-rollback@beebeeb.io')

    // Never authenticated, never reached the drive.
    expect(new URL(page.url()).pathname).not.toBe('/')

    await page.screenshot({ path: 'e2e/screenshots/1520-gate-b-bounced-back-with-field.png', fullPage: true })
  })
})
