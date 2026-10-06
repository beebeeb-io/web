/**
 * 1814 slice A — coupon links, free grants, on the REAL stack.
 *
 *   ADMIN    creates a free 1-month coupon in the admin UI, sees the worst-case
 *            capacity line, copies the link (clipboard read back).
 *   NEW      a brand-new visitor opens the link, signs up through the emailed-code
 *            flow (Mailpit), and lands on the granted plan: Pro, trialing, no
 *            mandate, no payment.
 *   EXISTING an account with no plan redeems the same link from Settings -> Billing.
 *   ALIAS    a third signup on the SAME mailbox (+tag alias) is refused by the server:
 *            "already used", plan unchanged.
 *   ADMIN 2  the redemptions drawer lists both grants; the coupon shows 2 of 5.
 *   REVOKE   the admin revokes the link; the next visitor gets "does not work any more"
 *            and the running grant is untouched.
 *
 * Needs (see the runner in the task's evidence dir): an API built from the 1814 server
 * branch with BB_SIGNUP_EMAIL_CODE=1 and BB_REQUIRE_PLAN_AT_SIGNUP=1, SMTP at Mailpit
 * (E2E_MAILPIT_URL), CORS for BOTH origins, a web build with
 * VITE_FEATURE_ONBOARDING_DOCUMENT=true (E2E_WEB_URL) and the admin dev server pointed
 * at the same API (E2E_ADMIN_URL). Screenshots go to E2E_EVIDENCE_DIR.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3003'
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:3002'
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'
const DB_NAME = process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'
const ADMIN_JWT_SECRET = process.env.E2E_ADMIN_JWT_SECRET ?? 'BEEBEEB_DEV_ADMIN_JWT_SECRET_DO_NOT_USE_IN_PRODUCTION'
const PASSWORD = 'Correct-Horse-Battery-9'

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(600_000)

async function missingPrerequisites(): Promise<string[]> {
  const missing: string[] = []
  if (process.env.BB_REQUIRE_PLAN_AT_SIGNUP !== '1') missing.push('BB_REQUIRE_PLAN_AT_SIGNUP=1')
  if (process.env.VITE_FEATURE_ONBOARDING_DOCUMENT !== 'true') missing.push('VITE_FEATURE_ONBOARDING_DOCUMENT=true')
  if (process.env.BB_SIGNUP_EMAIL_CODE !== '1') missing.push('BB_SIGNUP_EMAIL_CODE=1')
  try {
    const res = await fetch(`${MAILPIT}/api/v1/info`, { signal: AbortSignal.timeout(3_000) })
    if (!res.ok) missing.push(`Mailpit at ${MAILPIT} (HTTP ${res.status})`)
  } catch {
    missing.push(`Mailpit reachable at ${MAILPIT} (E2E_MAILPIT_URL)`)
  }
  try {
    const res = await fetch(ADMIN_URL, { signal: AbortSignal.timeout(3_000) })
    if (!res.ok) missing.push(`admin dev server at ${ADMIN_URL} (HTTP ${res.status})`)
  } catch {
    missing.push(`admin dev server reachable at ${ADMIN_URL} (E2E_ADMIN_URL)`)
  }
  return missing
}

test.beforeAll(async () => {
  const missing = await missingPrerequisites()
  test.skip(missing.length > 0, `1814 coupon spec needs: ${missing.join('; ')}`)
})

function sql(statement: string): string {
  const container = process.env.E2E_PG_CONTAINER ?? 'beebeebio-postgres-1'
  return execFileSync(
    'docker',
    ['exec', '-e', 'PGPASSWORD=beebeeb_dev', container, 'psql', '-U', 'beebeeb', '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
    .toString()
    .trim()
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url')

/** An aud:"admin" JWT for a freshly seeded admin user (HS256, the API's ADMIN_JWT_SECRET). */
function seedAdminToken(): string {
  const id = randomUUID()
  const email = `coupon-admin-${id.slice(0, 8)}@beebeeb.io`
  sql(`INSERT INTO users (id, email, password_hash, salt, email_verified, role) VALUES ('${id}', '${email}', 'x', 'x', TRUE, 'admin')`)
  const now = Math.floor(Date.now() / 1000)
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64(
    JSON.stringify({ sub: id, aud: 'admin', iss: 'beebeeb-api', iat: now, exp: now + 3600, role: 'admin', email, epoch: 0 }),
  )
  const sig = createHmac('sha256', ADMIN_JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

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
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no (new) code mail for ${email} in Mailpit within ${timeoutMs} ms`)
}

const screen = (page: Page) => page.getByTestId('onboarding-screen')

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

async function enterEmailAndCode(page: Page, email: string) {
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 30_000 })
  await page.getByTestId('onboarding-email').fill(email)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
  const code = await codeFromMailpit(email)
  await page.getByTestId('onboarding-code').fill(code)
  await page.getByRole('button', { name: /^verify$/i }).click()
}

async function acceptTerms(page: Page) {
  await expect(screen(page)).toHaveAttribute('data-screen', 'step:accept_terms')
  await page.getByRole('checkbox').nth(0).click()
  await page.getByRole('checkbox').nth(1).click()
  await page.getByTestId('accept-terms-continue').click()
}

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

/** The whole document-driven signup, from the email step to account creation. */
async function signUpThroughTheDocument(page: Page, email: string) {
  await enterEmailAndCode(page, email)
  await acceptTerms(page)
  await passwordAndPhrase(page)
}

async function subscription(page: Page) {
  const res = await page.request.get(`${API_URL}/api/v1/billing/subscription`)
  expect(res.ok(), `GET /billing/subscription: ${res.status()}`).toBe(true)
  return res.json()
}

const tag = Date.now().toString(36)
const mailboxBase = `gift${tag}`
const EMAILS = {
  newUser: `${mailboxBase}.new@gmail.com`,
  existing: `existing-${tag}@beebeeb.io`,
  alias: `${mailboxBase}.new+again@gmail.com`,
}

test('admin creates a free coupon; a new user signs up through the link and lands on the plan; an existing user redeems from Settings; the same mailbox is refused', async ({ browser }) => {
  const consentInit = () => localStorage.setItem('bb_cookie_consent', 'all')

  // ── ADMIN: create, capacity line, copy the link ─────────────────────────────
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await adminCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ADMIN_URL })
  const token = seedAdminToken()
  await adminCtx.addInitScript((t) => localStorage.setItem('bb_admin_session', t), token)
  const admin = await adminCtx.newPage()
  await admin.goto(`${ADMIN_URL}/plans`)
  await admin.getByRole('tab', { name: /promo codes/i }).or(admin.getByText('Promo codes', { exact: true })).first().click()
  await expect(admin.getByTestId('coupon-links')).toBeVisible({ timeout: 30_000 })
  await admin.getByTestId('coupon-new').click()
  await expect(admin.getByTestId('coupon-create-form')).toBeVisible()
  await expect(admin.getByTestId('coupon-price')).toHaveText('EUR 0.00 (free)')
  await admin.getByLabel('Coupon duration in months').fill('1')
  await admin.getByLabel('Coupon max redemptions').fill('5')
  await admin.getByLabel('Coupon note').fill('1814 e2e')
  // Round 2 (accountant review): a purpose and a reason are required, and the barter warning is shown.
  await expect(admin.getByTestId('coupon-barter-warning')).toContainText('Not for founders, staff, family')
  await expect(admin.getByTestId('coupon-create-submit')).toBeDisabled()
  await admin.getByLabel('Coupon purpose').selectOption('marketing')
  await expect(admin.getByTestId('coupon-create-submit')).toBeDisabled()
  await admin.getByLabel('Coupon reason').fill('Launch giveaway to newsletter readers (1814 e2e)')
  await expect(admin.getByTestId('coupon-create-submit')).toBeEnabled()
  const capacity = admin.getByTestId('coupon-capacity-line')
  await expect(capacity).toContainText('Worst case: 5 redemptions x Pro')
  await shot(admin, '01-admin-create-form-capacity-line')
  await admin.getByTestId('coupon-create-submit').click()
  const created = admin.getByTestId('coupon-created')
  await expect(created).toBeVisible({ timeout: 30_000 })
  const link = (await created.getByTestId('coupon-created-link').innerText()).trim()
  expect(link).toMatch(/\/c\/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
  await expect(created.getByTestId('coupon-created-capacity')).toContainText('Worst case: 5 redemptions x Pro')
  await created.getByTestId('coupon-copy-link').click()
  const clipboard = await admin.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toBe(link)
  await shot(admin, '02-admin-link-created-and-copied')
  const code = link.split('/c/')[1]

  // ── NEW user: link -> pitch -> signup (emailed code) -> granted plan ────────
  const newCtx = await browser.newContext({ viewport: { width: 1100, height: 1000 } })
  await newCtx.addInitScript(consentInit)
  const fresh = await newCtx.newPage()
  await fresh.goto(`${link}?nodev=1`)
  await expect(fresh.getByTestId('coupon-pitch')).toBeVisible({ timeout: 30_000 })
  await expect(fresh.getByRole('heading', { name: 'Pro for 1 month, free' })).toBeVisible()
  await expect(fresh.getByTestId('coupon-term-cost')).toContainText('do not ask for a card')
  await expect(fresh.getByTestId('coupon-term-after')).toContainText('read-only')
  await shot(fresh, '03-coupon-page-signed-out')
  await fresh.getByTestId('coupon-signup').click()
  await signUpThroughTheDocument(fresh, EMAILS.newUser)
  // create_account runs; the new account (needs_plan) is taken to the coupon, which claims it.
  await fresh.waitForURL(/\/c\//, { timeout: 120_000 })
  await expect(fresh.getByTestId('coupon-claimed')).toBeVisible({ timeout: 60_000 })
  await expect(fresh.getByRole('heading', { name: 'Pro is yours' })).toBeVisible()
  await shot(fresh, '04-new-user-claimed')
  const sub = await subscription(fresh)
  expect(sub).toMatchObject({ plan: 'pro', status: 'trialing', account_state: 'ok' })
  expect(sub.trial_auto_converts ?? false).toBe(false)
  expect(sql(`SELECT COALESCE(mollie_subscription_id, '') || COALESCE(mollie_mandate_id, '') FROM subscriptions WHERE user_id = (SELECT id FROM users WHERE email = '${EMAILS.newUser}')`)).toBe('')
  expect(sql(`SELECT COUNT(*) FROM payments WHERE user_id = (SELECT id FROM users WHERE email = '${EMAILS.newUser}')`)).toBe('0')
  expect(sql(`SELECT COUNT(*) FROM invoices WHERE user_id = (SELECT id FROM users WHERE email = '${EMAILS.newUser}')`)).toBe('0')
  await fresh.getByTestId('coupon-open-drive').click()
  await fresh.waitForURL((u) => u.pathname === '/', { timeout: 60_000 })
  await expect(fresh.getByTestId('lapsed-banner')).toHaveCount(0)
  await shot(fresh, '05-new-user-drive-on-pro')

  // ── EXISTING user: signs up WITHOUT a coupon (no plan), redeems from Settings ─
  const existCtx = await browser.newContext({ viewport: { width: 1100, height: 1000 } })
  await existCtx.addInitScript(consentInit)
  const exist = await existCtx.newPage()
  await exist.goto('/signup?nodev=1')
  await signUpThroughTheDocument(exist, EMAILS.existing)
  await exist.waitForURL(/\/choose-plan/, { timeout: 120_000 })
  expect((await subscription(exist)).account_state).toBe('needs_plan')
  await exist.goto('/settings/billing')
  await expect(exist.getByTestId('coupon-card')).toBeVisible({ timeout: 30_000 })
  await shot(exist, '06-settings-billing-coupon-card')
  // Round 2 (security review P2.7): a link with ?from=signup does NOT claim for a signed-in
  // account that never held it. It shows the pitch and waits for a click.
  await exist.goto(`${link.replace(/^https?:\/\/[^/]+/, '')}?from=signup&nodev=1`)
  await expect(exist.getByTestId('coupon-pitch')).toBeVisible({ timeout: 30_000 })
  await expect(exist.getByTestId('coupon-claim')).toBeVisible()
  await expect(exist.getByTestId('coupon-claimed')).toHaveCount(0)
  await shot(exist, '06b-from-signup-without-a-hold-does-not-claim')
  expect((await subscription(exist)).account_state).toBe('needs_plan')
  expect(sql(`SELECT COUNT(*) FROM promo_redemptions WHERE user_id = (SELECT id FROM users WHERE email = '${EMAILS.existing}')`)).toBe('0')
  await exist.goto('/settings/billing')
  await expect(exist.getByTestId('coupon-card')).toBeVisible({ timeout: 30_000 })
  // A wrong code is refused with the one honest answer; nothing changes.
  await exist.getByTestId('coupon-input').fill('ZZZZ-ZZZZ-ZZZZ')
  await exist.getByTestId('coupon-redeem').click()
  await expect(exist.getByTestId('coupon-card-refusal')).toContainText('does not work any more')
  // The pasted link works.
  await exist.getByTestId('coupon-input').fill(link)
  await exist.getByTestId('coupon-redeem').click()
  await expect(exist.getByTestId('coupon-card-claimed')).toContainText('Pro is yours', { timeout: 30_000 })
  await shot(exist, '07-existing-user-redeemed-from-settings')
  expect(await subscription(exist)).toMatchObject({ plan: 'pro', status: 'trialing', account_state: 'ok' })

  // ── ALIAS: the same mailbox (+tag) signs up through the link and is refused ──
  const aliasCtx = await browser.newContext({ viewport: { width: 1100, height: 1000 } })
  await aliasCtx.addInitScript(consentInit)
  const alias = await aliasCtx.newPage()
  await alias.goto(`${link}?nodev=1`)
  await expect(alias.getByTestId('coupon-pitch')).toBeVisible({ timeout: 30_000 })
  await alias.getByTestId('coupon-signup').click()
  await signUpThroughTheDocument(alias, EMAILS.alias)
  await alias.waitForURL(/\/c\//, { timeout: 120_000 })
  const refused = alias.getByTestId('coupon-refused')
  await expect(refused).toBeVisible({ timeout: 60_000 })
  await expect(alias.getByRole('heading', { name: 'This coupon has already been used' })).toBeVisible()
  await shot(alias, '08-same-mailbox-refused')
  // Refused means untouched: still no plan, and the coupon took no second slot for it.
  expect((await subscription(alias)).account_state).toBe('needs_plan')
  expect(sql(`SELECT COUNT(*) FROM promo_redemptions WHERE user_id = (SELECT id FROM users WHERE email = '${EMAILS.alias}')`)).toBe('0')
  // The held coupon ended with the refusal: the account now reaches the plan chooser.
  await alias.goto('/choose-plan')
  await expect(alias.getByTestId('choose-plan')).toBeVisible({ timeout: 30_000 })
  expect(sql(`SELECT redeemed_count FROM promo_codes WHERE code = '${code.replaceAll('-', '')}'`)).toBe('2')

  // ── ADMIN again: two redemptions listed, 2/5 redeemed ───────────────────────
  await admin.reload()
  await admin.getByRole('tab', { name: /promo codes/i }).or(admin.getByText('Promo codes', { exact: true })).first().click()
  const row = admin.getByTestId('coupon-row').filter({ hasText: code.replaceAll('-', '').slice(0, 4) })
  await expect(row.getByTestId('coupon-redeemed')).toContainText('2/5')
  await row.getByRole('button', { name: 'Redemptions' }).click()
  const drawer = admin.getByTestId('coupon-redemptions-drawer')
  await expect(drawer.getByTestId('coupon-redemption')).toHaveCount(2)
  await expect(drawer).toContainText(EMAILS.newUser)
  await expect(drawer).toContainText(EMAILS.existing)
  await shot(admin, '09-admin-redemptions-drawer')
  await admin.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)

  // ── ADMIN: revoke the link; it is dead for the next visitor, running grants stay ─
  const revoke = row.getByRole('button', { name: /hold to revoke link/i })
  await revoke.scrollIntoViewIfNeeded()
  const box = await revoke.boundingBox()
  if (!box) throw new Error('revoke button has no bounding box')
  await admin.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await admin.mouse.down()
  await admin.waitForTimeout(1900)
  await admin.mouse.up()
  await expect(row.getByTestId('coupon-state')).toHaveText('revoked', { timeout: 15_000 })
  await shot(admin, '10-admin-link-revoked')
  const lateCtx = await browser.newContext({ viewport: { width: 1100, height: 900 } })
  await lateCtx.addInitScript(consentInit)
  const late = await lateCtx.newPage()
  await late.goto(`${link}?nodev=1`)
  await expect(late.getByTestId('coupon-invalid')).toBeVisible({ timeout: 30_000 })
  await expect(late.getByRole('heading', { name: 'This link does not work any more' })).toBeVisible()
  await shot(late, '11-revoked-link-is-dead')
  // The grant that was already running is untouched.
  expect(await subscription(fresh)).toMatchObject({ plan: 'pro', status: 'trialing', account_state: 'ok' })

  // ── ADMIN ends the existing user's grant: the lapsed banner says "free period", not "trial" ──
  const [couponId, redemptionId] = sql(
    `SELECT promo_code_id || ' ' || id FROM promo_redemptions WHERE user_id = (SELECT id FROM users WHERE email = '${EMAILS.existing}')`,
  ).split(' ')
  const ended = await fetch(`${API_URL}/api/v1/admin/coupons/${couponId}/redemptions/${redemptionId}/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(ended.status, 'admin ends the grant').toBe(200)
  await exist.goto('/')
  const banner = exist.getByTestId('lapsed-banner')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  await expect(banner).toContainText('Your free period has ended')
  await expect(banner).not.toContainText(/trial/i)
  await shot(exist, '12-ended-gift-banner-says-free-period')
  expect(await subscription(exist)).toMatchObject({ account_state: 'lapsed', lapse_kind: 'gift' })

  await Promise.all([adminCtx.close(), newCtx.close(), existCtx.close(), aliasCtx.close(), lateCtx.close()])
})
