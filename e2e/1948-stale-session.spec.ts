/**
 * 1948 — a stale login of an account that is no longer active, and the refused
 * trial on a second account of the same inbox. REAL stack.
 *
 * Needs: the isolated harness (`e2e/scripts/web-e2e.sh`) with an API built from the
 * server branch that revokes logins on disable (server PR #216, task 1948 1a + 1b)
 * and the same environment as e2e/1757-no-card-trial.spec.ts:
 *   BB_REQUIRE_PLAN_AT_SIGNUP=1  BB_SIGNUP_EMAIL_CODE=1  BB_ENTRY_ALLOWANCE_BYTES=3000000
 *   BB_TRIAL_CLAIM_KEY=<any test value>  VITE_FEATURE_ONBOARDING_DOCUMENT=true
 *   SMTP_HOST=localhost SMTP_PORT=1025 SMTP_TLS_MODE=none  (Mailpit, E2E_MAILPIT_URL)
 *   MOLLIE_API_KEY=test_mock_local MOLLIE_API_BASE=http://localhost:$E2E_API_PORT/dev/mock-mollie/v2
 *
 *   ADMIN     — sign up, disable the account through the admin API, reload /signup: the
 *               old login is gone (401, not 403), no notice is needed, signup proceeds.
 *   STALE     — a login that predates the server fix (the account is disabled in SQL, its
 *               session row left in place, as prod had on 2026-10-17): /signup shows the
 *               notice, the legacy token is gone, and a new account is created with no
 *               403 on any signup endpoint.
 *   SIGNED-IN — the same stale login on a signed-in page: the "not active" screen with
 *               Sign out and support@beebeeb.io, no reason given; Sign out opens /login.
 *               With the server's cookie expiry (server#216 6d01f177) the 403 also expires
 *               the dead login's httpOnly cookie: after the notice no request carries a
 *               bb_session cookie (a reload of /signup is anonymous, no second notice), and
 *               the dead login's cookie value is never sent again during the new signup.
 *   TRIAL     — a second account on the same inbox (+tag) reaches the trial step and
 *               reads the honest copy. With BB_ENTRY_ALLOWANCE_BYTES > 0 the document already
 *               refuses it (unavailable_reason "already_used", the allowance is one per inbox);
 *               with BB_ENTRY_ALLOWANCE_BYTES=0 the start button is drawn and the start is
 *               refused (409 trial_already_used). Run both: E2E_GREP / two harness runs.
 */
import { test, expect, type Page, type Request, type Response } from '@playwright/test'
import {
  API_URL,
  missingPrerequisites,
  onboardingDoc,
  psql,
  setServerConfig,
  shot,
  shotBoth,
  signUpAllowanceAccount,
  userIdOf,
} from './helpers/no-card-trial'

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(300_000)
test.describe.configure({ mode: 'serial' })

const NOTICE = 'You were signed in to an account that is no longer active, so we signed you out on this device.'
const TRIAL_INBOX_COPY =
  'This email inbox has already had a free trial, so this account starts without one. You can pick a plan now.'
const GENERIC_403 = "You don't have permission to do that."

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const email = (tag: string) => `t1948-${tag}-${run}@beebeeb.io`

test.beforeAll(async () => {
  const missing = await missingPrerequisites()
  test.skip(missing.length > 0, `1948 real-API spec needs: ${missing.join('; ')}`)
})

/** Every 403 the API answers on this page, with its error code. */
function record403s(page: Page): Array<{ path: string; code: string }> {
  const seen: Array<{ path: string; code: string }> = []
  page.on('response', async (r: Response) => {
    if (r.status() !== 403 || !r.url().startsWith(API_URL)) return
    let code = ''
    try {
      code = String(((await r.json()) as { error?: unknown }).error ?? '')
    } catch {
      /* no JSON body */
    }
    seen.push({ path: new URL(r.url()).pathname, code })
  })
  return seen
}

const SIGNUP_PATHS = /\/api\/v1\/(onboarding|auth\/email|auth\/signup|opaque\/register)/

async function adminToken(): Promise<string> {
  const login = await fetch(`${API_URL}/dev/auto-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dev@beebeeb.dev' }),
  })
  expect(login.ok, `dev auto-login: ${login.status}`).toBe(true)
  const { admin_token } = (await login.json()) as { admin_token: string }
  expect(admin_token, 'dev auto-login must return an admin_token').toBeTruthy()
  return admin_token
}

async function meStatus(page: Page): Promise<number> {
  return (await page.request.get(`${API_URL}/api/v1/auth/me`)).status()
}

test('ADMIN — disabling through the admin API removes the login: the next visit is anonymous and signup proceeds', async ({ page }) => {
  const first = email('admin')
  await signUpAllowanceAccount(page, first)
  expect(await meStatus(page)).toBe(200)

  const res = await fetch(`${API_URL}/api/v1/admin/users/${userIdOf(first)}/suspend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await adminToken()}`, 'Content-Type': 'application/json' },
  })
  expect(res.ok, `POST /admin/users/:id/suspend: ${res.status}`).toBe(true)
  expect(psql(`SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = '${first}'`)).toBe('0')
  // The browser still sends its cookie; the server no longer knows it.
  expect(await meStatus(page)).toBe(401)

  const forbidden = record403s(page)
  await page.goto('/signup')
  await expect(page.getByTestId('onboarding-screen')).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 30_000 })
  await expect(page.getByTestId('account-inactive-notice')).toHaveCount(0)
  await shot(page, '1948-01-admin-disable-signup-anonymous')

  await signUpAllowanceAccount(page, email('admin-next'))
  expect(await meStatus(page)).toBe(200)
  expect(forbidden, 'no 403 anywhere during the second signup').toEqual([])
})

test('STALE — a login of a disabled account that predates the fix: notice on /signup, then a new account with no 403 on signup', async ({ page }) => {
  const stale = email('stale')
  await signUpAllowanceAccount(page, stale)
  const staleCookie = (await page.context().cookies(API_URL)).find((c) => c.name === 'bb_session')?.value
  expect(staleCookie, 'the stale account has a bb_session cookie before the notice').toBeTruthy()
  // Prod on 2026-10-17: the account was disabled, its session row was NOT removed.
  psql(`UPDATE users SET disabled_at = NOW() WHERE email = '${stale}'`)
  expect(psql(`SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = '${stale}'`)).not.toBe('0')
  // Probe OUTSIDE the browser's cookie jar: the server now expires the cookie on this
  // 403 (server#216 6d01f177), so a probe through `page.request` would itself sign the
  // browser out before the page ever saw the dead login.
  const me = await fetch(`${API_URL}/api/v1/auth/me`, { headers: { Cookie: `bb_session=${staleCookie}` } })
  expect(me.status).toBe(403)
  expect(((await me.json()) as { error?: string }).error).toBe('account_suspended')
  expect(me.headers.get('set-cookie') ?? '', 'the 403 expires the dead login cookie').toMatch(/bb_session=;.*Max-Age=0/i)

  const forbidden = record403s(page)
  await page.goto('/signup')
  const notice = page.getByTestId('account-inactive-notice')
  await expect(notice).toBeVisible({ timeout: 30_000 })
  await expect(notice).toHaveText(NOTICE)
  await expect(page.getByTestId('onboarding-screen')).toHaveAttribute('data-screen', 'step:enter_email')
  await expect(page.getByText(GENERIC_403)).toHaveCount(0)
  // The local half of the login is gone (the legacy bearer slot, the vault).
  expect(await page.evaluate(() => localStorage.getItem('bb_session'))).toBeNull()
  await shotBoth(page, '1948-02-stale-login-signup-notice')
  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, '1948-02-stale-login-signup-notice-phone')
  await page.setViewportSize({ width: 1280, height: 720 })

  // The server's half (task 1948 scope addition, server#216 6d01f177): the 403 expired the
  // httpOnly cookie, which JS cannot remove. From the notice on, until the new account's
  // own login exists, NO request may carry a bb_session cookie: a reload of /signup is
  // anonymous and does not show the notice a second time.
  expect(
    (await page.context().cookies(API_URL)).filter((c) => c.name === 'bb_session').map((c) => c.value),
    'the 403 expired the dead login cookie',
  ).toEqual([])
  let afterNoticeOpen = true
  let afterNoticeChecked = 0
  const afterNoticeOffenders: string[] = []
  const afterNoticePending: Promise<void>[] = []
  const afterNotice = (r: Request) => {
    if (!afterNoticeOpen || !r.url().startsWith(API_URL)) return
    afterNoticeChecked++
    afterNoticePending.push(
      // `headers()` omits Cookie; `allHeaders()` has what went on the wire.
      r.allHeaders().then((h) => {
        if ((h['cookie'] ?? '').includes('bb_session=')) afterNoticeOffenders.push(`${r.method()} ${new URL(r.url()).pathname}`)
      }),
    )
  }
  page.on('request', afterNotice)
  await page.reload()
  await expect(page.getByTestId('onboarding-screen')).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  afterNoticeOpen = false
  page.off('request', afterNotice)
  await Promise.all(afterNoticePending)
  console.log(`[1948] after the notice: API requests checked ${afterNoticeChecked}, carrying a bb_session cookie ${afterNoticeOffenders.length}`)
  expect(afterNoticeChecked, 'requests checked after the notice').toBeGreaterThan(0)
  expect(afterNoticeOffenders, 'requests carrying a bb_session cookie after the notice').toEqual([])
  await expect(page.getByTestId('account-inactive-notice')).toHaveCount(0)

  // During the whole new signup the dead login's cookie value is never sent again
  // (the new account's own cookie is, once it exists).
  let duringSignup = 0
  const staleSent: string[] = []
  const signupPending: Promise<void>[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith(API_URL)) return
    duringSignup++
    signupPending.push(
      r.allHeaders().then((h) => {
        if ((h['cookie'] ?? '').includes(`bb_session=${staleCookie}`)) staleSent.push(new URL(r.url()).pathname)
      }),
    )
  })

  const next = email('stale-next')
  await signUpAllowanceAccount(page, next)
  const me2 = await page.request.get(`${API_URL}/api/v1/auth/me`)
  expect(me2.status()).toBe(200)
  expect((await me2.json()).email).toBe(next)
  await expect(page.getByTestId('account-inactive-notice')).toHaveCount(0)
  await expect(page.getByText(GENERIC_403)).toHaveCount(0)
  expect(forbidden.filter((f) => SIGNUP_PATHS.test(f.path)), 'no 403 on a signup endpoint').toEqual([])
  // Only the boot check (and requests made while the dead login was loaded) may 403, and only with this code.
  for (const f of forbidden) expect(f.code, `${f.path}`).toBe('account_suspended')
  await Promise.all(signupPending)
  console.log(`[1948] 403s during STALE: ${JSON.stringify(forbidden)}; API requests during signup ${duringSignup}, carrying the dead login's cookie ${staleSent.length}`)
  expect(duringSignup, 'requests checked during the new signup').toBeGreaterThan(0)
  expect(staleSent, "requests carrying the dead login's cookie during the new signup").toEqual([])
  await shot(page, '1948-03-stale-login-new-account-created')
})

test('SIGNED-IN — the stale login on a signed-in page: not active, Sign out, support, no reason', async ({ page }) => {
  const stale = email('signedin')
  await signUpAllowanceAccount(page, stale)
  psql(`UPDATE users SET disabled_at = NOW() WHERE email = '${stale}'`)

  await page.goto('/settings/profile')
  const screen = page.getByTestId('account-inactive-screen')
  await expect(screen).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'This account is not active' })).toBeVisible()
  await expect(page.getByTestId('account-inactive-sign-out')).toHaveText('Sign out')
  await expect(page.getByTestId('account-inactive-support')).toHaveAttribute('href', 'mailto:support@beebeeb.io')
  const text = await page.locator('body').innerText()
  for (const why of [/suspend/i, /disabl/i, /abuse/i, /violat/i, /fraud/i]) expect(text).not.toMatch(why)
  expect(text).not.toContain(GENERIC_403)
  await shotBoth(page, '1948-04-signed-in-page-account-not-active')

  await page.getByTestId('account-inactive-sign-out').click()
  await page.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#login-email')).toBeVisible()
  await shot(page, '1948-05-after-sign-out-login')
})

test('TRIAL — a second account on the same inbox reaches the trial step and reads the honest copy', async ({ page, browser }) => {
  setServerConfig('no_card_trial_enabled', 'true')
  const base = `t1948-inbox-${run}`
  const firstAddr = `${base}+first@beebeeb.io`
  const secondAddr = `${base}+second@beebeeb.io`

  // The first account on the inbox takes the trial.
  await signUpAllowanceAccount(page, firstAddr)
  await page.goto('/choose-plan')
  await expect(page.getByTestId('start-trial')).toBeVisible({ timeout: 30_000 })
  const started = page.waitForResponse((r) => r.url().includes('/billing/trial/start') && r.request().method() === 'POST')
  await page.getByTestId('start-trial').click()
  expect((await started).status(), 'first account: POST /billing/trial/start').toBe(201)

  // The second account on the same inbox (another +tag), in a fresh browser.
  const ctx = await browser.newContext()
  const second = await ctx.newPage()
  try {
    await signUpAllowanceAccount(second, secondAddr)
    await second.goto('/choose-plan')
    await expect(second.getByTestId('choose-plan-chooser')).toBeVisible({ timeout: 30_000 })
    const doc = await onboardingDoc(second)
    if (doc.offers?.trial?.available === true) {
      // No entry allowance: the document offers the trial (it never consults the inbox
      // claim), the start is refused with trial_already_used.
      await shot(second, '1948-06-second-account-trial-step')
      const refused = second.waitForResponse((r) => r.url().includes('/billing/trial/start') && r.request().method() === 'POST')
      await second.getByTestId('start-trial').click()
      const res = await refused
      expect(res.status()).toBe(409)
      expect((await res.json()).error).toBe('trial_already_used')
      await expect(second.getByTestId('trial-start-error')).toHaveText(TRIAL_INBOX_COPY)
      await shotBoth(second, '1948-07-second-account-trial-refused-copy')
    } else {
      // Entry allowance on: the allowance is one per inbox too, so the document already
      // says unavailable_reason "already_used" and no start button is drawn.
      expect(doc.offers.trial).toMatchObject({ available: false, unavailable_reason: 'already_used' })
      await expect(second.getByTestId('start-trial')).toHaveCount(0)
      await expect(second.getByTestId('trial-unavailable')).toContainText(TRIAL_INBOX_COPY)
      await shotBoth(second, '1948-07-second-account-trial-unavailable-copy-allowance')
    }
    // "You can pick a plan now": the paid route is on the same screen.
    await expect(second.getByTestId('choose-plan-subscribe-now')).toBeVisible()
    await expect(second.getByText('You have already had your trial')).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})
