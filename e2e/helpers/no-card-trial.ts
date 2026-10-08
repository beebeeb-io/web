/**
 * Shared real-stack helpers for the no-card trial spec (task 1757).
 *
 * Everything here talks to the REAL server the isolated harness started
 * (`e2e/scripts/web-e2e.sh`): signup through the document-driven /signup (Mailpit
 * delivers the code), SQL for the two things only an operator can do (switch the
 * no-card trial on, move the trial clock), and the admin worker trigger to run the
 * hourly lifecycle sweep on demand instead of waiting an hour.
 */
import { execFileSync } from 'node:child_process'
import { expect, type Page } from '@playwright/test'

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'
export const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'
export const PASSWORD = 'Correct-Horse-Battery-9'
export const ALLOWANCE = Number(process.env.BB_ENTRY_ALLOWANCE_BYTES ?? '0')

const PG_URL = `postgres://beebeeb:beebeeb_dev@localhost:${process.env.E2E_PG_PORT ?? '5434'}/${process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'}`

/** Run one SQL statement against the harness DB; returns the trimmed `-At` output. */
export function psql(statement: string): string {
  try {
    return execFileSync('psql', [PG_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe' }).toString().trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const container = process.env.E2E_PG_CONTAINER ?? 'beebeebio-postgres-1'
    const db = process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'
    return execFileSync(
      'docker',
      ['exec', '-e', 'PGPASSWORD=beebeeb_dev', container, 'psql', '-U', 'beebeeb', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement],
      { stdio: 'pipe' },
    )
      .toString()
      .trim()
  }
}

export function setServerConfig(key: string, value: string): void {
  psql(
    `INSERT INTO server_config (key, value) VALUES ('${key}', '${value}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
  )
}

export function deleteServerConfig(key: string): void {
  psql(`DELETE FROM server_config WHERE key = '${key}'`)
}

/** Every prerequisite, named, so a missing one skips with a message (a skip is NOT a pass). */
export async function missingPrerequisites(): Promise<string[]> {
  const missing: string[] = []
  if (process.env.BB_REQUIRE_PLAN_AT_SIGNUP !== '1') missing.push('BB_REQUIRE_PLAN_AT_SIGNUP=1')
  if (!process.env.BB_ENTRY_ALLOWANCE_BYTES) missing.push('BB_ENTRY_ALLOWANCE_BYTES (small, e.g. 3000000)')
  if (!process.env.BB_TRIAL_CLAIM_KEY) missing.push('BB_TRIAL_CLAIM_KEY (any test value)')
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

/** The 8-digit code in the newest mail to `email` that is not in `exclude`. */
export async function codeFromMailpit(email: string, exclude: string[] = [], timeoutMs = 30_000): Promise<string> {
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
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no (new) code mail for ${email} in Mailpit within ${timeoutMs} ms`)
}

export const screen = (page: Page) => page.getByTestId('onboarding-screen')

/** Full-page screenshot to the evidence directory, after a short settle. */
export async function shot(page: Page, name: string) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

/** Light and dark of the same moment: `<name>-light.png`, `<name>-dark.png`. */
export async function shotBoth(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, `${name}-light`)
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, `${name}-dark`)
  await page.emulateMedia({ colorScheme: 'light' })
}

/**
 * Sign a brand-new account up through the real document-driven /signup and land on
 * the drive as an ALLOWANCE account (verified, never paid). Returns the email.
 */
export async function signUpAllowanceAccount(page: Page, email: string): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('bb_cookie_consent', 'all'))
  await page.goto('/signup?nodev=1')
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 30_000 })
  await page.getByTestId('onboarding-email').fill(email)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
  const code = await codeFromMailpit(email)
  await page.getByTestId('onboarding-code').fill(code)
  await page.getByRole('button', { name: /^verify$/i }).click()
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:accept_terms')
  await page.getByRole('checkbox').nth(0).click()
  await page.getByRole('checkbox').nth(1).click()
  await page.getByTestId('accept-terms-continue').click()
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
  await page.waitForURL((u) => u.pathname === '/' || u.pathname === '/choose-plan', { timeout: 90_000 })
  await skipTours(page)
}

export async function skipTours(page: Page) {
  for (const name of [/skip tour/i, /skip for now/i]) {
    const b = page.getByRole('button', { name }).first()
    await b.waitFor({ state: 'visible', timeout: 4_000 }).then(() => b.click()).catch(() => {})
  }
}

/** The account half of the onboarding document, as the server serves it right now. */
export async function onboardingDoc(page: Page) {
  // The server classifies the caller by this header (the web app sends it on every request):
  // without it the document is the anonymous-platform one, which carries no `offers`.
  const res = await page.request.get(`${API_URL}/api/v1/onboarding`, { headers: { 'X-Beebeeb-Client': 'web' } })
  expect(res.ok(), `GET /onboarding: ${res.status()}`).toBe(true)
  return res.json()
}

export async function subscription(page: Page) {
  const res = await page.request.get(`${API_URL}/api/v1/billing/subscription`)
  expect(res.ok(), `GET /billing/subscription: ${res.status()}`).toBe(true)
  return res.json()
}

/**
 * Run the hourly billing lifecycle sweep NOW (admin worker trigger, authenticated as the
 * harness's dev superadmin with the ADMIN JWT that the debug-only /dev/auto-login returns
 * as `admin_token`; the API's admin routes refuse an ordinary session token, task 1785). The trigger spawns the cycle; `until` is polled so the
 * caller continues only once the sweep's effect is visible.
 */
export async function runLifecycleSweep(until: () => boolean | Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const login = await fetch(`${API_URL}/dev/auto-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dev@beebeeb.dev' }),
  })
  expect(login.ok, `dev auto-login: ${login.status}`).toBe(true)
  const { admin_token } = (await login.json()) as { admin_token: string }
  expect(admin_token, 'dev auto-login must return an admin_token (API built from server >= task 1785)').toBeTruthy()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/api/v1/admin/workers/billing_lifecycle/trigger`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin_token}`, 'Content-Type': 'application/json' },
    })
    expect(res.ok, `POST /admin/workers/billing_lifecycle/trigger: ${res.status}`).toBe(true)
    // Give the spawned cycle a moment, then check its effect.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (await until()) return
    }
  }
  throw new Error('the lifecycle sweep ran but its effect never became visible')
}

export function userIdOf(email: string): string {
  return psql(`SELECT id FROM users WHERE email = '${email}'`)
}

/** Total bytes the account has stored (the figure quota is measured on). */
export function usedBytes(email: string): number {
  return Number(
    psql(`SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE user_id = '${userIdOf(email)}' AND is_folder = FALSE AND is_uploading = FALSE`),
  )
}
