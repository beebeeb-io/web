import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'

/**
 * Task 1610 — 2FA settings row must not error for an already-enabled
 * account, and "Set up again" must go through step-up.
 *
 * Before the fix: `TotpSection` ran its own `getMe()` fetch and started
 * `enabled` at `false` while it was in flight, so an already-enrolled
 * account's first paint of `/settings/security` could show the "Set up"
 * affordance, which calls `setup2fa()` with no code/token — the server
 * correctly 403s `confirmation_required` once 2FA is on (`routes/totp.rs`
 * `setup_step_up_validated_if_required`, verified correct, not loosened).
 * The exact repro (curl against the shared dev API with a real 2FA-enabled
 * session, no code/token) is pasted in this task's Notes.
 *
 * After the fix: `enabled` reads straight from `useAuth().user.totp_enabled`
 * (already resolved before this page can mount — ProtectedRoute in app.tsx),
 * so opening the settings option never shows a raw error, and "Set up again"
 * asks for the current code (or password) before regenerating the secret.
 *
 * Real-stack only: runs against the isolated harness (e2e/scripts/web-e2e.sh),
 * same as 2fa-wrong-code-feedback.spec.ts.
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

async function enableFreshTotp(page: import('@playwright/test').Page): Promise<string> {
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
  return secret
}

test('2FA on: settings shows the On state and "Set up again" via code reissues + reverifies the secret', async ({ page }) => {
  test.setTimeout(240_000)
  const email = uniqueEmail('1610-on')
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  await signupAndUnlock(page, { email, password: PW })

  const secret = await enableFreshTotp(page)

  // Re-open the settings option fresh (a full reload — the exact "opens the
  // 2FA option in settings" the bug report describes) and assert the On
  // state renders immediately, with NEVER the raw server error visible.
  await page.reload()
  await expect(page.getByText(/requires password confirmation/i)).toHaveCount(0)
  await expect(page.getByText(/^On$/).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /^turn off$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^set up again$/i })).toBeVisible()
  await page.screenshot({
    path: '/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/1610/web/1610-gate1-on-state.png',
  })

  // "Set up again" — the reauth panel: code input + password alternative.
  await page.getByRole('button', { name: /^set up again$/i }).click()
  const reauthInput = page.locator('input[placeholder="6-digit code"]').last()
  await expect(reauthInput).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/use your password instead/i)).toBeVisible()
  await page.screenshot({
    path: '/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/1610/web/1610-gate2-reauth-code-prompt.png',
  })

  // A wrong code is a clear inline message, never a raw error.
  const wrongResp = page.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/setup'))
  await reauthInput.fill(wrongCode(secret))
  await page.getByRole('button', { name: /^continue$/i }).click()
  expect((await wrongResp).status()).toBe(400)
  await expect(page.getByText(/incorrect code/i)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/requires password confirmation/i)).toHaveCount(0)

  // The CURRENT code succeeds and reissues a NEW secret + backup codes.
  const okResp = page.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/setup'))
  await reauthInput.fill(totp(secret))
  await page.getByRole('button', { name: /^continue$/i }).click()
  expect((await okResp).status()).toBe(200)

  const newSecretEl = page.locator('code.font-mono').first()
  await expect(newSecretEl).toBeVisible({ timeout: 15_000 })
  const newSecret = (await newSecretEl.innerText()).trim()
  expect(newSecret).not.toBe(secret)
  await page.screenshot({
    path: '/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/1610/web/1610-gate3-reauth-new-secret.png',
  })

  // Re-verify with the NEW secret to finish the "set up again" round trip.
  await page.getByPlaceholder('6-digit code').fill(totp(newSecret))
  await page.getByRole('button', { name: /^verify$/i }).click()
  const savedAgain = page.getByRole('button', { name: /I've saved these codes/i })
  await expect(savedAgain).toBeVisible({ timeout: 15_000 })
  await page.screenshot({
    path: '/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/1610/web/1610-gate4-reauth-success-backup-codes.png',
  })
  await savedAgain.click()

  // Back to the On state — 2FA is still on, now under the new secret.
  await expect(page.getByText(/^On$/).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/requires password confirmation/i)).toHaveCount(0)

  // The OLD secret's codes must no longer work (proves the secret actually
  // rotated server-side, not just in the UI) — "Turn off" with the old code
  // is rejected.
  await page.getByRole('button', { name: /^turn off$/i }).click()
  const disableInput = page.locator('input[placeholder="6-digit code"]').last()
  await disableInput.fill(totp(secret))
  const rejectedResp = page.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/disable'))
  await page.getByRole('button', { name: /^turn off 2fa$/i }).click()
  expect((await rejectedResp).status()).toBe(400)
})

test('2FA on: "Set up again" via password step-up also reaches a new secret', async ({ page }) => {
  test.setTimeout(240_000)
  const email = uniqueEmail('1610-pw')
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  await signupAndUnlock(page, { email, password: PW })

  const secret = await enableFreshTotp(page)
  await page.reload()

  await page.getByRole('button', { name: /^set up again$/i }).click()
  await page.getByText(/use your password instead/i).click()

  const dialog = page.getByRole('dialog', { name: /confirm your identity/i })
  await expect(dialog).toBeVisible({ timeout: 5_000 })
  await dialog.getByPlaceholder('Your password').fill(PW)
  const stepUpResp = page.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/setup'))
  await dialog.getByRole('button', { name: /^continue$/i }).click()
  expect((await stepUpResp).status()).toBe(200)

  const newSecretEl = page.locator('code.font-mono').first()
  await expect(newSecretEl).toBeVisible({ timeout: 15_000 })
  const newSecret = (await newSecretEl.innerText()).trim()
  expect(newSecret).not.toBe(secret)
})
