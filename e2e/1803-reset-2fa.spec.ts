import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { NEW_PW, totp, wrongCode, makeAccount, guestPage, requestResetLink, setNewPassword, meStatus } from './helpers/reset-2fa'

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

const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1803'
fs.mkdirSync(SHOTS, { recursive: true })
// AuthShell fades in; let it settle so the capture shows the finished screen.
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true })
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
  await expect(g.getByRole('heading', { name: /set up this device/i })).toBeVisible({ timeout: 30_000 })
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

  await expect(g.getByRole('heading', { name: /set up this device/i })).toBeVisible({ timeout: 30_000 })
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
