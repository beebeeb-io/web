/**
 * 1822 (P0, 2026-10-06) — an EXISTING account that never accepted the Terms
 * version in force must still reach its drive. Real stack: the isolated harness
 * API (built from the server branch), a web build with
 * VITE_FEATURE_ONBOARDING_DOCUMENT=true, the dev auto-login account with its
 * `terms_acceptances` row removed (an account that predates the table).
 *
 * Decision 1812 Q2: terms are enforced at the new ticketed signup, advisory for
 * existing accounts. Task 1740 emitted a REQUIRED, blocking `accept_terms` step;
 * once the web gated on blocking documents (1816) every existing account landed
 * on "We cannot do this step here yet / Continue on the web".
 *
 * Run:  VITE_FEATURE_ONBOARDING_DOCUMENT=true E2E_API_PORT=… E2E_VITE_PORT=… \
 *       E2E_DB_NAME=… E2E_API_BIN=<server branch binary> \
 *       ./e2e/scripts/web-e2e.sh e2e/1822-existing-account-terms-advisory.spec.ts
 */
import { execFileSync } from 'node:child_process'
import { test, expect, type Page, type Route } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'
const DB = process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'
const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'beebeebio-postgres-1'
const DEV_EMAIL = 'dev@beebeeb.dev'

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  // A skip is NOT a pass: without the flag this spec proves nothing, so it fails.
  expect(
    process.env.VITE_FEATURE_ONBOARDING_DOCUMENT,
    'this spec needs VITE_FEATURE_ONBOARDING_DOCUMENT=true in the env that starts the harness',
  ).toBe('true')
})

/** An account that predates `terms_acceptances`: no acceptance of any version. */
function forgetAcceptance(): void {
  execFileSync('docker', [
    'exec', '-e', 'PGPASSWORD=beebeeb_dev', PG_CONTAINER,
    'psql', '-U', 'beebeeb', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-c',
    `DELETE FROM terms_acceptances WHERE user_id = (SELECT id FROM users WHERE email = '${DEV_EMAIL}')`,
  ])
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

async function sessionCookie(page: Page): Promise<string> {
  const c = (await page.context().cookies()).find((x) => x.name === 'bb_session')
  expect(c, 'bb_session cookie').toBeTruthy()
  return c!.value
}

async function document_(page: Page) {
  const res = await page.request.get(`${API_URL}/api/v1/onboarding`, {
    headers: { Cookie: `bb_session=${await sessionCookie(page)}` },
  })
  expect(res.ok(), `GET /onboarding: ${res.status()}`).toBe(true)
  return res.json()
}

const driveReached = async (page: Page) => {
  await expect(page.locator('input[type="file"]').first()).toBeAttached({ timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe('/')
}

const NOT_BLOCKED_COPY = [/We cannot do this step here yet/i, /Continue on the web/i]

async function expectNoBlockedCard(page: Page) {
  for (const re of NOT_BLOCKED_COPY) await expect(page.getByText(re)).toHaveCount(0)
  await expect(page.getByTestId('onboarding-screen')).toHaveCount(0)
}

/** Serve the real document with `patch` applied, until `until()` says stop. */
async function patchDocument(page: Page, patch: (doc: any) => void, until: () => boolean = () => false) {
  await page.route('**/api/v1/onboarding*', async (route: Route) => {
    if (route.request().method() !== 'GET' || until()) return route.continue()
    const res = await route.fetch()
    const doc = await res.json()
    patch(doc)
    await route.fulfill({ response: res, json: doc })
  })
}

test.beforeEach(async ({ page }) => {
  forgetAcceptance()
  await page.addInitScript(() => {
    try {
      localStorage.setItem('bb_cookie_consent', 'all')
    } catch { /* ignore */ }
  })
})

test('an existing account with no acceptance signs in and lands on the drive', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', undefined, { timeout: 30_000 })
  // The outcome the person sees first: the drive, not a blocked card.
  await driveReached(page)
  await expectNoBlockedCard(page)
  await shot(page, '1822-01-existing-account-lands-on-drive')

  // And the document says why: advisory, never blocking.
  const doc = await document_(page)
  const step = doc.steps.find((s: any) => s.id === 'accept_terms')
  expect(step, `the document asks for the Terms version in force: ${JSON.stringify(doc.steps)}`).toBeTruthy()
  expect(step.required, 'existing accounts: terms are advisory (decision 1812 Q2)').toBe(false)
  expect(doc.blocking, 'an unaccepted advisory step never blocks').toBe(false)
})

test('the Accept screen works when it is reached: records the version and the step disappears', async ({ page }) => {
  await page.goto('/account-status')
  const card = page.getByTestId('step-accept_terms')
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByTestId('terms-version')).toHaveText(/^\d{4}-\d{2}-\d{2}$/)
  await expect(card.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', 'https://beebeeb.io/terms')
  await expect(card.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', 'https://beebeeb.io/privacy')
  await shot(page, '1822-02-accept-terms-card')

  const posted = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/account/terms-acceptance') && r.request().method() === 'POST',
  )
  await card.getByTestId('accept-terms-accept').click()
  expect((await posted).status()).toBe(200)

  await expect(page.getByTestId('step-accept_terms')).toHaveCount(0, { timeout: 15_000 })
  const doc = await document_(page)
  expect(doc.steps.find((s: any) => s.id === 'accept_terms')).toBeUndefined()
  expect(doc.blocking).toBe(false)
  await expect(page.getByTestId('account-open-files')).toBeVisible()
  await shot(page, '1822-03-accept-terms-recorded')
})

test('an old-shape REQUIRED accept_terms (blocking) is drawn as a real Accept screen, never the blocked card', async ({ page }) => {
  let accepted = false
  page.on('response', (r) => {
    if (r.url().endsWith('/api/v1/account/terms-acceptance') && r.request().method() === 'POST' && r.ok()) accepted = true
  })
  await patchDocument(
    page,
    (doc) => {
      const step = doc.steps.find((s: any) => s.id === 'accept_terms') ?? {
        id: 'accept_terms', status: 'todo', ui: 'action', params: { version: '2026-10-01' },
      }
      step.required = true
      doc.steps = [step, ...doc.steps.filter((s: any) => s.id !== 'accept_terms')]
      doc.blocking = true
    },
    () => accepted,
  )
  await page.goto('/')
  await expect(page.getByTestId('onboarding-screen')).toHaveAttribute('data-screen', 'step:accept_terms', { timeout: 30_000 })
  await expectNoBlockedCardCopy(page)
  await shot(page, '1822-04-required-accept-terms-screen')
  await page.getByTestId('accept-terms-accept').click()
  await driveReached(page)
  await expectNoBlockedCard(page)
})

async function expectNoBlockedCardCopy(page: Page) {
  for (const re of NOT_BLOCKED_COPY) await expect(page.getByText(re)).toHaveCount(0)
}

test('an unknown required ACCOUNT step never blocks the drive: dismissible notice, no "Continue on the web"', async ({ page }) => {
  await patchDocument(page, (doc) => {
    doc.steps = [{ id: 'verify_identity', status: 'todo', required: true, ui: 'action' }, ...doc.steps]
    doc.blocking = true
  })
  await page.goto('/')
  await driveReached(page)
  await expectNoBlockedCard(page)
  const banner = page.getByTestId('unsupported-step-banner')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  await expect(banner).toContainText('verify_identity')
  await expect(banner).toContainText('Your files are not affected')
  // The harness's dev-only "auto-logged in" bar is fixed over the top of the page; close it.
  await page.getByLabel('Dismiss dev banner').click().catch(() => {})
  await shot(page, '1822-05-unknown-required-step-notice-on-drive')

  await page.getByTestId('unsupported-step-dismiss').click()
  await expect(banner).toHaveCount(0)
  await page.reload()
  await driveReached(page)
  await expect(page.getByTestId('unsupported-step-banner')).toHaveCount(0)

  // The account page says the same, in words, with no way out that loops.
  await page.goto('/account-status')
  await expect(page.getByTestId('unsupported-steps-note')).toContainText('verify_identity')
  await expectNoBlockedCardCopy(page)
  await shot(page, '1822-06-account-page-unsupported-note')
})
