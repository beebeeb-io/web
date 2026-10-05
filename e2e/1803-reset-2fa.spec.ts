import { test, expect, type Browser, type Page } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'
import { anonymousContext } from './helpers/auth'
import { setPasswordToken } from './helpers/reset-link'

/**
 * Task 1803 (client half of server task 1730, Guus ruling A): a password reset
 * or a recovery-phrase recovery NEVER bypasses 2FA.
 *
 *  - TOTP account, email link: forgot-password -> /set-password/<token> -> new
 *    password -> the 2FA code step (no session yet) -> signed in.
 *  - A wrong code is said, not swallowed, and keeps the step.
 *  - TOTP account, recovery phrase: the same code step before the vault re-wrap.
 *  - Account without TOTP: signed in directly, no code step.
 *  - A reset by a client that does NOT declare the capability (header stripped
 *    here) lands on "Your new password is set. Sign in to continue." with a link
 *    to /login, and no session.
 *
 * Real stack only: needs an API built from server PR #156 (the `reset-2fa`
 * capability) behind the isolated harness (e2e/scripts/web-e2e.sh).
 */

const PW = 'Correct-Horse-Battery-Staple-42'
const NEW_PW = 'A-Brand-New-Passphrase-1803'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1803'
fs.mkdirSync(SHOTS, { recursive: true })
// AuthShell fades in; let it settle so the capture shows the finished screen.
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true })
}

function totp(secretB32: string, offsetSteps = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = secretB32.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()
  let bits = ''
  for (const c of clean) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter % 2 ** 32, 4)
  const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
}

function wrongCode(secret: string): string {
  const valid = new Set([totp(secret, -1), totp(secret), totp(secret, 1)])
  for (const c of ['123456', '654321', '111111', '222222']) if (!valid.has(c)) return c
  throw new Error('could not pick a wrong code')
}

/** Sign up, optionally turn TOTP on, return what a later reset needs. */
async function makeAccount(page: Page, prefix: string, withTotp: boolean) {
  const email = uniqueEmail(prefix)
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  const { recoveryPhrase } = await signupAndUnlock(page, { email, password: PW })
  let secret = ''
  if (withTotp) {
    await page.goto('/settings/security')
    await page.getByRole('button', { name: /^set up$/i }).click()
    const secretEl = page.locator('code.font-mono').first()
    await expect(secretEl).toBeVisible({ timeout: 15_000 })
    secret = (await secretEl.innerText()).trim()
    await page.getByPlaceholder('6-digit code').fill(totp(secret))
    await page.getByRole('button', { name: /^verify$/i }).click()
    const saved = page.getByRole('button', { name: /I've saved these codes/i })
    await expect(saved).toBeVisible({ timeout: 15_000 })
    await saved.click()
  }
  return { email, recoveryPhrase, secret }
}

/** A guest browser: no cookies, no storage, dev auto-login blocked. */
async function guestPage(browser: Browser): Promise<Page> {
  const ctx = await anonymousContext(browser)
  await ctx.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  return ctx.newPage()
}

/** forgot-password through the UI, then the emailed link's token. */
async function requestResetLink(page: Page, email: string): Promise<string> {
  await page.goto('/forgot-password?nodev=1')
  await page.getByPlaceholder('you@example.com').fill(email)
  const sent = page.waitForResponse((r) => r.url().includes('/api/v1/auth/forgot-password'))
  await page.locator('button[type=submit]').first().click()
  expect((await sent).status()).toBe(200)
  const { token, usedMailpit } = await setPasswordToken(email)
  test.info().annotations.push({ type: 'link-source', description: usedMailpit ? 'real email via Mailpit' : 'token minted in DB (no Mailpit)' })
  return token
}

async function setNewPassword(page: Page, token: string) {
  await page.goto(`/set-password/${token}`)
  await page.getByLabel('New password').fill(NEW_PW)
  await page.getByLabel('Confirm password').fill(NEW_PW)
}

async function meStatus(page: Page): Promise<number> {
  // The API origin differs from the web origin; ask it directly with the
  // page's cookie jar (the bb_session cookie is shared across localhost ports).
  const api = process.env.E2E_API_URL ?? 'http://localhost:3001'
  return (await page.context().request.get(`${api}/api/v1/auth/me`)).status()
}

test('TOTP account: set-password ends at the 2FA code step, then signs in', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const { email, secret } = await makeAccount(page, '1803-link', true)

  const g = await guestPage(browser)
  const token = await requestResetLink(g, email)
  await setNewPassword(g, token)
  await shot(g, '01-set-password-form.png')

  const finish = g.waitForResponse((r) => r.url().includes('/api/v1/auth/set-password-finish'))
  await g.getByRole('button', { name: /set new password/i }).click()
  const finishRes = await finish
  // The capability header left the browser, and the server answered a challenge, not a session.
  expect(finishRes.request().headers()['x-beebeeb-capabilities']).toBe('reset-2fa')
  expect(finishRes.status()).toBe(200)
  const body = await finishRes.json()
  expect(body.requires_2fa).toBe(true)
  expect(typeof body.partial_token).toBe('string')
  expect(body.session_token).toBeUndefined()

  const codeInput = g.getByLabel('6-digit verification code')
  await expect(codeInput).toBeAttached({ timeout: 30_000 })
  await expect(g.getByText(/your new password is set/i).first()).toBeVisible()
  // No session until the code is accepted.
  expect(await meStatus(g)).toBe(401)
  await shot(g, '02-two-factor-step.png')

  // Wrong code: said, not swallowed; the step stays.
  const bad = g.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/verify'))
  await codeInput.fill(wrongCode(secret))
  expect((await bad).status()).toBe(401)
  await expect(g.getByText(/incorrect code/i)).toBeVisible({ timeout: 10_000 })
  await expect(codeInput).toHaveValue('')
  expect(await meStatus(g)).toBe(401)
  await shot(g, '03-wrong-code.png')

  // Right code: session opens, the reset completes.
  const good = g.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/verify'))
  await codeInput.fill(totp(secret))
  expect((await good).status()).toBe(200)
  await expect(g.getByRole('heading', { name: /password set/i })).toBeVisible({ timeout: 30_000 })
  expect(await meStatus(g)).toBe(200)
  await shot(g, '04-signed-in-after-code.png')
})

test('account without TOTP: set-password signs in directly, no code step', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const { email } = await makeAccount(page, '1803-plain', false)

  const g = await guestPage(browser)
  const token = await requestResetLink(g, email)
  await setNewPassword(g, token)

  const finish = g.waitForResponse((r) => r.url().includes('/api/v1/auth/set-password-finish'))
  await g.getByRole('button', { name: /set new password/i }).click()
  const body = await (await finish).json()
  expect(body.requires_2fa).toBeUndefined()
  expect(typeof body.session_token).toBe('string')

  await expect(g.getByRole('heading', { name: /password set/i })).toBeVisible({ timeout: 30_000 })
  await expect(g.getByLabel('6-digit verification code')).toHaveCount(0)
  expect(await meStatus(g)).toBe(200)
  await shot(g, '05-no-totp-signed-in.png')
})

test('TOTP account: recovery-phrase finalize also ends at the 2FA code step', async ({ page, browser }) => {
  test.setTimeout(300_000)
  const { email, recoveryPhrase, secret } = await makeAccount(page, '1803-phrase', true)

  const g = await guestPage(browser)
  await g.goto('/recover-with-phrase?nodev=1')
  await g.getByLabel('Email address').fill(email)
  await g.getByPlaceholder(/word1 word2/).fill(recoveryPhrase)
  await g.getByRole('button', { name: /verify phrase/i }).click()

  await g.getByLabel('New password').fill(NEW_PW)
  await g.getByLabel('Confirm password').fill(NEW_PW)
  const finish = g.waitForResponse((r) => r.url().includes('/api/v1/auth/recover-with-phrase-finalize'))
  await g.getByRole('button', { name: /set new password/i }).click()
  const finishRes = await finish
  expect(finishRes.request().headers()['x-beebeeb-capabilities']).toBe('reset-2fa')
  const body = await finishRes.json()
  expect(body.requires_2fa).toBe(true)
  expect(body.session_token).toBeUndefined()

  const codeInput = g.getByLabel('6-digit verification code')
  await expect(codeInput).toBeAttached({ timeout: 30_000 })
  expect(await meStatus(g)).toBe(401)
  await shot(g, '06-recovery-two-factor-step.png')

  const good = g.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/verify'))
  await codeInput.fill(totp(secret))
  expect((await good).status()).toBe(200)
  // Signed in and the vault re-wrapped under the new password: the success
  // screen is shown, then (the session is now live, so GuestRoute moves a
  // signed-in visitor on) the drive renders with the vault open.
  await expect(
    g.getByRole('heading', { name: /password updated/i }).or(g.getByText(/All files/i).first()),
  ).toBeVisible({ timeout: 30_000 })
  await expect(g.getByText(/All files/i).first()).toBeVisible({ timeout: 30_000 })
  expect(await meStatus(g)).toBe(200)
  await shot(g, '07-recovery-signed-in.png')
})

test('a client that does not declare reset-2fa gets the sign-in-required screen, and no session', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const { email } = await makeAccount(page, '1803-legacy', true)

  const g = await guestPage(browser)
  const token = await requestResetLink(g, email)
  // Play an old cached bundle: strip the capability header from the finalize call.
  await g.route('**/api/v1/auth/set-password-finish', async (route) => {
    const headers = { ...route.request().headers() }
    delete headers['x-beebeeb-capabilities']
    await route.continue({ headers })
  })
  await setNewPassword(g, token)

  const finish = g.waitForResponse((r) => r.url().includes('/api/v1/auth/set-password-finish'))
  await g.getByRole('button', { name: /set new password/i }).click()
  const res = await finish
  expect(res.status()).toBe(409)
  expect((await res.json()).error).toBe('password_set_sign_in_required')

  await expect(g.getByText('Your new password is set. Sign in to continue.')).toBeVisible({ timeout: 15_000 })
  await expect(g.getByTestId('reset-sign-in-required')).toBeVisible()
  // Never the "link is invalid" copy: the password WAS rotated.
  await expect(g.getByText(/invalid, expired, or already used/i)).toHaveCount(0)
  await expect(g.getByLabel('6-digit verification code')).toHaveCount(0)
  const signIn = g.getByRole('link', { name: /^sign in$/i })
  await expect(signIn).toHaveAttribute('href', '/login')
  expect(await meStatus(g)).toBe(401)
  await shot(g, '08-sign-in-required.png')
})
