/**
 * 1816 — an ALLOWANCE account follows the onboarding document, not the legacy
 * plan gate. Real stack: server with BB_ENTRY_ALLOWANCE_BYTES (small),
 * BB_REQUIRE_PLAN_AT_SIGNUP=1, BB_SIGNUP_EMAIL_CODE=1, Mailpit for the code, and a
 * web build with VITE_FEATURE_ONBOARDING_DOCUMENT=true.
 *
 * The contract maps an allowance account to the legacy account_state
 * `needs_plan`, and the pre-1816 gate sent it to /choose-plan: the drive never
 * opened. Expected now: the document says `allowance`, the drive opens, an upload
 * inside the allowance succeeds, an upload over it is refused, and the sidebar
 * meter measures the allowance.
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
  if (!process.env.BB_ENTRY_ALLOWANCE_BYTES) missing.push('BB_ENTRY_ALLOWANCE_BYTES (small, e.g. 3000000)')
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
  test.skip(missing.length > 0, `1816 real-API spec needs: ${missing.join('; ')}`)
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


const ALLOWANCE = Number(process.env.BB_ENTRY_ALLOWANCE_BYTES ?? '0')

async function onboardingState(page: Page) {
  const res = await page.request.get(`${API_URL}/api/v1/onboarding`)
  expect(res.ok(), `GET /onboarding: ${res.status()}`).toBe(true)
  return (await res.json()).account
}

async function skipTours(page: Page) {
  for (const name of [/skip tour/i, /skip for now/i]) {
    const b = page.getByRole('button', { name }).first()
    await b.waitFor({ state: 'visible', timeout: 4_000 }).then(() => b.click()).catch(() => {})
  }
}

test('ALLOWANCE — a verified never-paid account lands on the drive, uploads within the allowance, is refused over it', async ({ page }) => {
  const uploadStatuses: number[] = []
  page.on('response', (r) => {
    if (/\/(files\/upload|uploads)\//.test(r.url()) && r.request().method() === 'POST') uploadStatuses.push(r.status())
  })
  const email = uniqueEmail('v1816-allowance')
  await openSignup(page)
  await enterEmailAndCode(page, email)
  await acceptTerms(page)
  await passwordAndPhrase(page)

  // create_account runs. The server creates a ticket-signup account with
  // email_verified = false (see the task notes), so it starts as needs_plan.
  await page.waitForURL(/\/choose-plan/, { timeout: 90_000 })
  expect((await onboardingState(page)).state).toBe('needs_plan')
  // The person clicks the verification link in their mail; here: the same
  // column the link sets.
  sql(`UPDATE users SET email_verified = TRUE WHERE email = '${email}'`)
  await page.goto('/')
  // Let the plan gate settle (it waits for the subscription + document), then
  // require that it did NOT send the account to the plan chooser.
  await page.locator('[data-testid="choose-plan"], input[type="file"]').first().waitFor({ state: 'attached', timeout: 30_000 })
  await shot(page, '1816-00-after-signup-goto-root')
  expect(new URL(page.url()).pathname, 'allowance account must not be redirected to /choose-plan').not.toBe('/choose-plan')
  await skipTours(page)
  await expect(page.locator('input[type="file"]').first()).toBeAttached({ timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe('/')

  // The legacy label is the old bug's cause; the document is what we followed.
  expect((await subscription(page)).account_state).toBe('needs_plan')
  const account = await onboardingState(page)
  expect(account.state).toBe('allowance')
  expect(account.storage.quota_bytes).toBe(ALLOWANCE)
  // Every protected route opens, not just "/".
  await page.goto('/settings/security')
  expect(new URL(page.url()).pathname).toBe('/settings/security')
  await page.goto('/')
  await skipTours(page)

  // Honest meter: labelled Allowance, measured against the allowance.
  const footer = page.locator('div.mt-auto', { hasText: 'Storage' }).last()
  await expect(footer).toContainText('Allowance', { timeout: 30_000 })
  await expect(footer).toContainText(/\/ 3(\.0)? MB/)
  await expect(footer).not.toContainText('No plan')
  await shot(page, '1816-01-drive-allowance-meter')

  // Inside the allowance: a 1 MB upload lands.
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'within-allowance.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1_000_000, 7),
  })
  await expect(page.getByText('within-allowance.bin').first()).toBeVisible({ timeout: 60_000 })
  await shot(page, '1816-02-upload-within-allowance')

  // Over the allowance: refused with the honest quota message (the upload
  // pre-flight compares against the allowance; the server enforces the same
  // limit), and the file does not appear.
  const before = uploadStatuses.length
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'over-allowance.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(Math.max(ALLOWANCE, 2_500_000), 9),
  })
  await expect(page.getByText('Not enough storage').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/you only have 2 MB remaining/).first()).toBeVisible()
  // Not the plan-gate copy: this is a quota refusal, not "start your trial to upload".
  await expect(page.getByText('Start your trial to upload')).toHaveCount(0)
  expect(uploadStatuses.slice(before).every((s) => s < 400)).toBe(true)
  await page.waitForTimeout(1_000)
  await expect(page.getByText('over-allowance.bin')).toHaveCount(0)
  await shot(page, '1816-03-upload-over-allowance-refused')
  // Still on the drive afterwards (a refusal is not a redirect to the chooser).
  expect(new URL(page.url()).pathname).toBe('/')
})
