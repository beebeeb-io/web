/**
 * 1745 — the document-driven onboarding renderer on the REAL stack.
 *
 * No page.route mocks except the one test that must manufacture a future step
 * the real server cannot send yet (it rewrites the real document in flight).
 * Needs: FEATURE_ONBOARDING_DOCUMENT build (VITE_FEATURE_ONBOARDING_DOCUMENT=true),
 * a server with 1739 + 1738, BB_REQUIRE_PLAN_AT_SIGNUP=1, Mollie pointed at the
 * debug mock (MOLLIE_API_KEY=test_mock_local, MOLLIE_API_BASE=…/dev/mock-mollie/v2),
 * SMTP pointed at Mailpit (SMTP_HOST=localhost SMTP_PORT=1025 SMTP_TLS_MODE=none;
 * E2E_MAILPIT_URL, default http://localhost:8025) so the emailed code is real.
 *
 *   PAID     — document signup → /choose-plan (needs_plan, every route comes back)
 *              → mock Mollie mandate → trialing → lapsed (SQL, as lapse_row does)
 *              → read-only banner. Every step asserted to come from the document.
 *   UNKNOWN  — a required step this client does not know stops with the fallback.
 *   EXPIRY   — the ticket expires before register: back to the code step, the new
 *              code finishes the signup (phrase + password kept).
 */
import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'
import { uniqueEmail } from './helpers/signup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'
const PG_URL = `postgres://beebeeb:beebeeb_dev@localhost:${process.env.E2E_PG_PORT ?? '5434'}/${process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'}`
const PASSWORD = 'Correct-Horse-Battery-9'

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(300_000)
/**
 * Every prerequisite, checked up front. A missing one skips with a message that
 * names it (a skip is NOT a pass) instead of letting the tests time out.
 * The server-side flags (plan gate, emailed code, mock Mollie) are read from the
 * env the harness inherits; the renderer flag is baked into the web build, so
 * VITE_FEATURE_ONBOARDING_DOCUMENT must be set for the build web-e2e.sh starts.
 */
async function missingPrerequisites(): Promise<string[]> {
  const missing: string[] = []
  if (process.env.BB_REQUIRE_PLAN_AT_SIGNUP !== '1') missing.push('BB_REQUIRE_PLAN_AT_SIGNUP=1')
  if (!process.env.MOLLIE_API_BASE) missing.push('MOLLIE_API_BASE -> the debug mock Mollie')
  if (process.env.VITE_FEATURE_ONBOARDING_DOCUMENT !== 'true') missing.push('VITE_FEATURE_ONBOARDING_DOCUMENT=true')
  if (process.env.BB_SIGNUP_EMAIL_CODE !== '1') missing.push('BB_SIGNUP_EMAIL_CODE=1')
  try {
    const res = await fetch(`${MAILPIT}/api/v1/info`, { signal: AbortSignal.timeout(3_000) })
    if (!res.ok) missing.push(`Mailpit at ${MAILPIT} (HTTP ${res.status})`)
  } catch {
    missing.push(`Mailpit reachable at ${MAILPIT} (E2E_MAILPIT_URL)`)
  }
  return missing
}

test.beforeAll(async () => {
  const missing = await missingPrerequisites()
  test.skip(missing.length > 0, `1745 real-API spec needs: ${missing.join('; ')}`)
})

function sql(statement: string): void {
  try {
    execFileSync('psql', [PG_URL, '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const container = process.env.E2E_PG_CONTAINER ?? 'beebeebio-postgres-1'
    const db = process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'
    execFileSync('docker', ['exec', '-e', 'PGPASSWORD=beebeeb_dev', container, 'psql', '-U', 'beebeeb', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe' })
  }
}

/** The 8-digit code in the newest mail to `email` that is not in `exclude`. */
async function codeFromMailpit(email: string, exclude: string[] = [], timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
      if (res.ok) {
        const data = (await res.json()) as { messages?: Array<{ ID: string }> }
        for (const m of data.messages ?? []) {
          const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text?: string }
          const hit = (msg.Text ?? '').match(/\b(\d{8})\b/)
          if (hit && !exclude.includes(hit[1])) return hit[1]
        }
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no (new) code mail for ${email} in Mailpit within ${timeoutMs} ms`)
}

const screen = (page: Page) => page.getByTestId('onboarding-screen')

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

async function subscription(page: Page) {
  const res = await page.request.get(`${API_URL}/api/v1/billing/subscription`)
  expect(res.ok(), `GET /billing/subscription: ${res.status()}`).toBe(true)
  return res.json()
}

async function openSignup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('bb_cookie_consent', 'all'))
  await page.goto('/signup?nodev=1')
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 30_000 })
}

async function enterEmailAndCode(page: Page, email: string): Promise<string> {
  await page.getByTestId('onboarding-email').fill(email)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
  const code = await codeFromMailpit(email)
  await page.getByTestId('onboarding-code').fill(code)
  await page.getByRole('button', { name: /^verify$/i }).click()
  return code
}

async function acceptTerms(page: Page) {
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:accept_terms')
  await page.getByRole('checkbox').nth(0).click()
  await page.getByRole('checkbox').nth(1).click()
  await page.getByTestId('accept-terms-continue').click()
}

/** set_password → phrase → confirm; stops when create_account starts. */
async function passwordAndPhrase(page: Page) {
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
  await page.getByTestId('onboarding-password').fill(PASSWORD)
  await page.getByTestId('onboarding-password-confirm').fill(PASSWORD)
  await page.getByTestId('set-password-continue').click()
  await expect(page.getByTestId('phrase-words')).toBeVisible({ timeout: 30_000 })
  const words: string[] = []
  for (let i = 1; i <= 12; i++) words.push((await page.getByTestId(`phrase-word-${i}`).innerText()).trim())
  await page.getByRole('checkbox').click()
  await page.getByTestId('phrase-saved').click()
  const inputs = page.locator('[data-testid^="phrase-answer-"]')
  await expect(inputs).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    const id = (await inputs.nth(i).getAttribute('data-testid'))!
    await page.getByTestId(id).fill(words[Number(id.replace('phrase-answer-', '')) - 1])
  }
  await page.getByRole('button', { name: /^confirm$/i }).click()
}

async function startTrialCheckout(page: Page, method: 'ideal' | 'creditcard') {
  await page.getByTestId(`trial-method-${method}`).click()
  await page.getByTestId('choose-plan-continue').click()
  await expect(page.getByTestId('billing-info-step')).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Full name').fill('Trial Tester')
  await page.getByTestId('billing-country').selectOption('NL')
  await page.getByLabel('Street and house number').fill('Hoofdstraat 1')
  await page.getByLabel('Postal code').fill('6602 AB')
  await page.getByLabel('City').fill('Wijchen')
  await expect(page.getByTestId('vat-gross')).not.toHaveText('…', { timeout: 10_000 })
  const checkout = page.waitForResponse((r) => r.url().includes('/api/v1/billing/trial/checkout') && r.request().method() === 'POST')
  await page.getByRole('button', { name: /Start 14-day free trial/ }).click()
  const res = await checkout
  if (res.status() !== 200) throw new Error(`POST /billing/trial/checkout ${res.status()}`)
  await page.waitForURL(/\/dev\/mock-mollie\/checkout\//, { timeout: 15_000 })
  await expect(page.getByTestId('mock-mollie-checkout')).toBeVisible()
}

test('PAID — document signup → needs_plan → mock Mollie mandate → trialing → lapsed', async ({ page }) => {
  const docRequests: number[] = []
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/onboarding') && r.request().method() === 'GET') docRequests.push(r.status())
  })
  const email = uniqueEmail('v1745-paid')
  await openSignup(page)
  // The flagged build draws /signup from the server's document (not the legacy page).
  expect(docRequests.length).toBeGreaterThan(0)
  expect(docRequests.every((s) => s === 200)).toBe(true)
  await shot(page, '01-signup-email-from-document')

  await enterEmailAndCode(page, email)
  await shot(page, '02-after-real-code')
  await acceptTerms(page)
  await passwordAndPhrase(page)

  // create_account runs, then the app sends a needs_plan account to the chooser.
  await page.waitForURL(/\/choose-plan/, { timeout: 90_000 })
  await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
  expect((await subscription(page)).account_state).toBe('needs_plan')
  await shot(page, '03-needs-plan-choose-plan')

  // needs_plan redirect: any app route comes back to the chooser.
  await page.goto('/')
  await page.waitForURL(/\/choose-plan/, { timeout: 30_000 })
  await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
  await page.goto('/settings/security')
  await page.waitForURL(/\/choose-plan/, { timeout: 30_000 })

  // The document-driven account view for this state (renderer, not the chooser).
  await page.goto('/account-status')
  await expect(screen(page)).toBeVisible({ timeout: 30_000 })
  const needsPlanScreen = await screen(page).getAttribute('data-screen')
  expect(needsPlanScreen).not.toBe('fallback')
  await shot(page, '04-account-status-needs-plan')
  await page.goto('/choose-plan')
  await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })

  await startTrialCheckout(page, 'ideal')
  await shot(page, '05-mock-mollie-checkout')
  await page.getByTestId('mock-mollie-pay').click()
  await page.waitForURL(/\/choose-plan\?returned=1/, { timeout: 30_000 })
  await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 })
  const sub = await subscription(page)
  expect(sub).toMatchObject({ status: 'trialing', account_state: 'ok', trial_auto_converts: true })
  await shot(page, '06-trialing-drive')

  // Lapse it the way the server's lapse_row does (trial ended unpaid).
  sql(`UPDATE users SET plan_required = TRUE, has_used_trial = TRUE WHERE email = '${email}';
       UPDATE subscriptions SET status = 'cancelled', plan = 'none', trial_ends_at = NULL,
         storage_grace_deadline = NOW() + INTERVAL '60 days', cancel_wipe_due_at = NULL
       WHERE user_id = (SELECT id FROM users WHERE email = '${email}');`)
  expect((await subscription(page)).account_state).toBe('lapsed')
  await page.goto('/')
  const banner = page.getByTestId('lapsed-banner')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe('/')
  await shot(page, '07-lapsed-banner')
  await page.goto('/account-status')
  await expect(screen(page)).toBeVisible({ timeout: 30_000 })
  expect(await screen(page).getAttribute('data-screen')).not.toBe('fallback')
  await shot(page, '08-account-status-lapsed')
})

test('UNKNOWN — a required step this client does not know stops with the fallback (real document, rewritten in flight)', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/api/v1/onboarding',
    async (route) => {
      const res = await route.fetch()
      const doc = await res.json()
      const i = doc.steps.findIndex((s: { id: string }) => s.id === 'accept_terms')
      doc.steps.splice(i, 0, { id: 'confirm_phone_number', status: 'todo', required: true, ui: 'action' })
      await route.fulfill({ response: res, json: doc })
    },
  )
  await openSignup(page)
  await enterEmailAndCode(page, uniqueEmail('v1745-unknown'))
  await expect(screen(page)).toHaveAttribute('data-screen', 'fallback', { timeout: 30_000 })
  await expect(page.getByTestId('fallback-step-id')).toHaveText('confirm_phone_number')
  await shot(page, '09-unknown-required-step-fallback')
})

test('EXPIRY — the ticket expires before register: back to the code step, a new code finishes the signup', async ({ page }) => {
  const email = uniqueEmail('v1745-expiry')
  await openSignup(page)
  const firstCode = await enterEmailAndCode(page, email)
  await acceptTerms(page)
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
  // The ticket lapses while the person is choosing a password.
  sql(`UPDATE signup_tickets SET expires_at = NOW() - INTERVAL '1 minute' WHERE email = '${email}';`)
  await passwordAndPhrase(page)

  await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code', { timeout: 60_000 })
  await shot(page, '10-ticket-expired-back-to-code-step')

  // A fresh code (the document's resend wait applies) and the rest of the walk.
  const again = page.getByRole('button', { name: 'Send a new code' })
  await expect(again).toBeVisible({ timeout: 80_000 })
  await again.click()
  const newCode = await codeFromMailpit(email, [firstCode])
  await page.getByTestId('onboarding-code').fill(newCode)
  await page.getByRole('button', { name: /^verify$/i }).click()

  // Phrase and password were kept: no terms/password/phrase to redo, create_account completes.
  await page.waitForURL(/\/choose-plan/, { timeout: 90_000 })
  await expect(page.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
  expect((await subscription(page)).account_state).toBe('needs_plan')
  await shot(page, '11-after-expiry-recovered-choose-plan')
})
