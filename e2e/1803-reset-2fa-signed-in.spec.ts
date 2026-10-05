import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { anonymousContext } from './helpers/auth'
import { totp, wrongCode, makeAccount, guestPage, requestResetLink, setNewPassword, meStatus } from './helpers/reset-2fa'

/**
 * Task 1803 round 2 (Codex P2 on web#139): a SIGNED-IN user whose vault is
 * locked can open the reset page (GuestRoute lets an authenticated-but-locked
 * visitor through), and getMe() has already marked the page load
 * session-confirmed. Finalize then deletes every old session, so the first WRONG
 * code at /auth/2fa/verify is an expected 401. Before the fix the shared request
 * client read that 401 as session expiry, fired the global handler and sent the
 * person to /login before the step could say "incorrect code".
 *
 * Needs an API with the `reset-2fa` capability (server #156) behind the isolated
 * harness (e2e/scripts/web-e2e.sh).
 */

test.describe.configure({ retries: 0 })

const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1803-signed-in'
fs.mkdirSync(SHOTS, { recursive: true })

test('signed-in locked-vault user: wrong reset code keeps the step, right code signs in', async ({ page, browser }) => {
  test.setTimeout(240_000)
  // A real signed-in account with TOTP. makeAccount leaves this page's context
  // with the bb_session cookie and dev auto-login blocked.
  const { email, secret } = await makeAccount(page, '1803-signedin', true)

  // The link is requested from a separate guest browser so the signed-in
  // context's session is untouched until the finalize call deletes it.
  const g = await guestPage(browser)
  const token = await requestResetLink(g, email)

  // Authenticated + vault LOCKED: carry only the bb_session cookie into a clean
  // browser context (no IndexedDB wrapped vault, no stay-unlocked key), exactly
  // what a returning user on a locked tab looks like. GuestRoute lets that
  // visitor onto the reset page, and getMe() marks the page load
  // session-confirmed — the precondition of the bug.
  const cookies = await page.context().cookies()
  expect(cookies.some((c) => c.name === 'bb_session')).toBe(true)
  const ctx = await anonymousContext(browser)
  await ctx.addCookies(cookies)
  await ctx.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  const locked = await ctx.newPage()
  await setNewPassword(locked, token)
  expect(await meStatus(locked)).toBe(200)
  expect(new URL(locked.url()).pathname).toBe(`/set-password/${token}`)

  const finish = locked.waitForResponse((r) => r.url().includes('/api/v1/auth/set-password-finish'))
  await locked.getByRole('button', { name: /set new password/i }).click()
  const body = await (await finish).json()
  expect(body.requires_2fa).toBe(true)

  const codeInput = locked.getByLabel('6-digit verification code')
  await expect(codeInput).toBeAttached({ timeout: 30_000 })

  // Wrong code: the 401 reaches the step, the retry message shows, the page
  // does not leave for /login.
  const bad = locked.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/verify'))
  await codeInput.fill(wrongCode(secret))
  expect((await bad).status()).toBe(401)
  await expect(locked.getByText(/incorrect code/i)).toBeVisible({ timeout: 10_000 })
  await expect(codeInput).toHaveValue('')
  await locked.waitForTimeout(1500) // a session-expired navigation is async; give it room to (not) happen
  expect(new URL(locked.url()).pathname).toBe(`/set-password/${token}`)
  await expect(locked.getByText(/session expired/i)).toHaveCount(0)
  await locked.waitForTimeout(800)
  await locked.screenshot({ path: path.join(SHOTS, '01-wrong-code-stays.png'), fullPage: true })

  // Right code: signed in.
  const good = locked.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/verify'))
  await codeInput.fill(totp(secret))
  expect((await good).status()).toBe(200)
  await expect(
    locked.getByRole('heading', { name: /set up this device/i }).or(locked.getByText(/All files/i).first()),
  ).toBeVisible({ timeout: 30_000 })
  expect(new URL(locked.url()).pathname).not.toBe('/login')
  expect(await meStatus(locked)).toBe(200)
  await locked.waitForTimeout(800)
  await locked.screenshot({ path: path.join(SHOTS, '02-signed-in-after-code.png'), fullPage: true })
})
