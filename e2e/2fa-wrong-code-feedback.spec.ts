import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'

/**
 * Wrong 2FA code at sign-in must be SAID, not swallowed (flow "Support, help &
 * communication", fix lane 0).
 *
 * Before the fix: login.tsx rendered <TwoFactorPrompt> without an `error`
 * prop, and handle2faVerify caught the 401 and wrote it to the page-level
 * error that the 2FA branch never renders — so the prompt kept showing the
 * wrong digits with no message at all.
 *
 * Real-stack only: runs against the isolated harness (e2e/scripts/web-e2e.sh).
 */

const PW = 'Correct-Horse-Battery-Staple-42'

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

/** A 6-digit code that is NOT valid in the server's ±1 step window. */
function wrongCode(secret: string): string {
  const valid = new Set([totp(secret, -1), totp(secret), totp(secret, 1)])
  for (const c of ['123456', '654321', '111111', '222222']) if (!valid.has(c)) return c
  throw new Error('could not pick a wrong code')
}

test('wrong 2FA code at sign-in shows "Incorrect code" and clears the field', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const email = uniqueEmail('2fa-wrong')
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  await signupAndUnlock(page, { email, password: PW })

  // Enable TOTP.
  await page.goto('/settings/security')
  await page.getByRole('button', { name: /^set up$/i }).click()
  const secretEl = page.locator('code.font-mono').first()
  await expect(secretEl).toBeVisible({ timeout: 15_000 })
  const secret = (await secretEl.innerText()).trim()
  await page.getByPlaceholder('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: /^verify$/i }).click()
  const saved = page.getByRole('button', { name: /I've saved these codes/i })
  await expect(saved).toBeVisible({ timeout: 15_000 })
  await saved.click()

  // Second device: password step, then a WRONG code.
  const ctx = await browser.newContext()
  await ctx.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  const p2 = await ctx.newPage()
  await p2.goto('/login?nodev=1')
  await p2.getByPlaceholder('you@example.com').fill(email)
  await p2.getByPlaceholder('Your password').last().fill(PW)
  await p2.locator('button[type=submit]').first().click()
  const codeInput = p2.getByLabel('6-digit verification code')
  await expect(codeInput).toBeAttached({ timeout: 30_000 })

  const verifyResp = p2.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/verify'))
  await codeInput.fill(wrongCode(secret))
  expect((await verifyResp).status()).toBe(401)

  await expect(p2.getByText(/incorrect code/i)).toBeVisible({ timeout: 10_000 })
  await expect(codeInput).toHaveValue('')
  // Still on the 2FA step — the partial token is kept so the user can retry.
  await expect(p2.getByText(/enter the 6-digit code/i)).toBeVisible()
  await p2.screenshot({ path: test.info().outputPath('2fa-wrong-code.png') })

  // And the retry actually works with the same partial token: the server
  // accepts it and this fresh device moves on to key provisioning.
  const retryResp = p2.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/verify'))
  await codeInput.fill(totp(secret))
  expect((await retryResp).status()).toBe(200)
  await expect(p2.getByRole('heading', { name: /set up this device/i })).toBeVisible({ timeout: 60_000 })
  await ctx.close()
})
