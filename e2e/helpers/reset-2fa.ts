import { test, expect, type Browser, type Page } from '@playwright/test'
import crypto from 'crypto'
import { signupAndUnlock, uniqueEmail } from './signup'
import { anonymousContext } from './auth'
import { setPasswordToken } from './reset-link'

/** Shared by the task 1803 reset-2FA specs (e2e/1803-reset-2fa*.spec.ts). */

export const PW = 'Correct-Horse-Battery-Staple-42'
export const NEW_PW = 'A-Brand-New-Passphrase-1803'

export function totp(secretB32: string, offsetSteps = 0): string {
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

export function wrongCode(secret: string): string {
  const valid = new Set([totp(secret, -1), totp(secret), totp(secret, 1)])
  for (const c of ['123456', '654321', '111111', '222222']) if (!valid.has(c)) return c
  throw new Error('could not pick a wrong code')
}

/** Sign up, optionally turn TOTP on, return what a later reset needs. */
export async function makeAccount(page: Page, prefix: string, withTotp: boolean) {
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
export async function guestPage(browser: Browser): Promise<Page> {
  const ctx = await anonymousContext(browser)
  await ctx.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  return ctx.newPage()
}

/** forgot-password through the UI, then the emailed link's token. */
export async function requestResetLink(page: Page, email: string): Promise<string> {
  await page.goto('/forgot-password?nodev=1')
  await page.getByPlaceholder('you@example.com').fill(email)
  const sent = page.waitForResponse((r) => r.url().includes('/api/v1/auth/forgot-password'))
  await page.locator('button[type=submit]').first().click()
  expect((await sent).status()).toBe(200)
  const { token, usedMailpit } = await setPasswordToken(email)
  test.info().annotations.push({ type: 'link-source', description: usedMailpit ? 'real email via Mailpit' : 'token minted in DB (no Mailpit)' })
  return token
}

export async function setNewPassword(page: Page, token: string) {
  await page.goto(`/set-password/${token}`)
  await page.getByLabel('New password').fill(NEW_PW)
  await page.getByLabel('Confirm password').fill(NEW_PW)
}

export async function meStatus(page: Page): Promise<number> {
  // The API origin differs from the web origin; ask it directly with the
  // page's cookie jar (the bb_session cookie is shared across localhost ports).
  const api = process.env.E2E_API_URL ?? 'http://localhost:3001'
  return (await page.context().request.get(`${api}/api/v1/auth/me`)).status()
}
