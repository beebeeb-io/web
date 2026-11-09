import { test, expect, type Page, type Request } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'

/**
 * Server #422 (v2 B16) asks a 2FA account for its second factor on `DELETE /api/v1/auth/account`.
 * This PR: after the password step-up, the delete page asks a 2FA account for its 6-digit
 * authenticator code or an 8-digit backup code and sends it as `code`; an account without 2FA
 * gets no code field and sends the same body as before.
 *
 * Real stack only: the isolated harness (e2e/scripts/web-e2e.sh) with a server built from #422.
 * Both accounts are created through the real sign-up flow. Every screenshot is paired with
 * counted assertions (dialogs, fields, DELETE requests sent), never a picture alone.
 */

const PW = 'Correct-Horse-Battery-Staple-42'

/** Screenshots go to `B16_WEB222_SHOTS` when set (the evidence folder), else the test output. */
function shotPath(name: string): string {
  const dir = process.env.B16_WEB222_SHOTS
  if (!dir) return test.info().outputPath(name)
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, name)
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

/** A 6-digit code that is NOT valid in the server's ±1 step window. */
function wrongCode(secret: string): string {
  const valid = new Set([totp(secret, -1), totp(secret), totp(secret, 1)])
  for (const c of ['123456', '654321', '111111', '222222']) if (!valid.has(c)) return c
  throw new Error('could not pick a wrong code')
}

/** Settings → Security → set up 2FA; returns the secret and the backup codes shown once. */
async function enableTotp(page: Page): Promise<{ secret: string; backupCodes: string[] }> {
  await page.goto('/settings/security')
  await page.getByRole('button', { name: /^set up$/i }).click()
  const secretEl = page.locator('code.font-mono').first()
  await expect(secretEl).toBeVisible({ timeout: 15_000 })
  const secret = (await secretEl.innerText()).trim()
  await page.getByPlaceholder('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: /^verify$/i }).click()
  const saved = page.getByRole('button', { name: /I've saved these codes/i })
  await expect(saved).toBeVisible({ timeout: 15_000 })
  const codeEls = page.locator('span.font-mono.text-\\[14px\\]')
  await expect(codeEls).toHaveCount(8)
  const backupCodes = (await codeEls.allInnerTexts()).map((c) => c.trim())
  await saved.click()
  return { secret, backupCodes }
}

/** Every `DELETE /api/v1/auth/account` the page sends, with its JSON body. */
function trackDeletes(page: Page): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = []
  page.on('request', (r: Request) => {
    if (r.method() === 'DELETE' && new URL(r.url()).pathname === '/api/v1/auth/account') {
      sent.push((r.postDataJSON() as Record<string, unknown>) ?? {})
    }
  })
  return sent
}

/** Fill the delete page and pass the password step-up. */
async function startDelete(page: Page): Promise<void> {
  await page.goto('/settings/delete-account')
  await page.getByPlaceholder('DELETE').fill('DELETE')
  await page.getByText(/I understand my files are encrypted/i).click()
  await page.getByRole('button', { name: /^delete permanently$/i }).click()
  await page.getByPlaceholder('Your password').fill(PW)
  await page.getByRole('button', { name: /^delete account$/i }).click()
}

const codeDialog = (page: Page) => page.getByRole('dialog', { name: 'Enter your two-factor code' })

test.describe.configure({ retries: 0 })

test('2FA account: the delete asks for the code, sends it as `code`, and a wrong code is an honest error', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  await signupAndUnlock(page, { email: uniqueEmail('b16-2fa'), password: PW })
  const { secret, backupCodes } = await enableTotp(page)
  const deletes = trackDeletes(page)

  // After the password step-up: the code prompt, and nothing sent yet.
  await startDelete(page)
  const dialog = codeDialog(page)
  await expect(dialog).toHaveCount(1)
  await expect(dialog.getByLabel('Code')).toHaveCount(1)
  await expect(dialog.getByText(/6-digit code from your authenticator app, or an 8-digit backup code/)).toHaveCount(1)
  expect(deletes.length).toBe(0)
  await page.screenshot({ path: shotPath('01-2fa-code-prompt.png') })

  // A wrong 6-digit code: sent as `code`, refused by the server, shown under the field.
  const wrong = wrongCode(secret)
  const refused = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname === '/api/v1/auth/account',
  )
  await dialog.getByLabel('Code').fill(wrong)
  await dialog.getByRole('button', { name: /^delete account$/i }).click()
  const refusal = await refused
  expect(refusal.status()).toBe(400)
  expect(deletes.length).toBe(1)
  expect(deletes[0]).toEqual({ confirmation: 'DELETE', code: wrong })
  await expect(page.getByText("That code didn't match. Check your authenticator app and try again.")).toHaveCount(1)
  await expect(page).toHaveURL(/\/settings\/delete-account/)
  await page.screenshot({ path: shotPath('02-2fa-wrong-code-error.png') })

  // The server spent the step-up on that try: the page drops the token and returns to the
  // password step with one honest line. Never "Re-authentication expired".
  await expect(codeDialog(page)).toHaveCount(0)
  await expect(page.getByPlaceholder('Your password')).toHaveCount(1)
  await expect(page.getByText("That code didn't work. Confirm your password again to try once more.")).toHaveCount(1)
  await expect(page.getByText(/Re-authentication expired/)).toHaveCount(0)
  await page.screenshot({ path: shotPath('03-2fa-wrong-code-back-to-password.png') })

  // A fresh step-up and an 8-digit backup code: sent as `code`, the account is deleted.
  await page.getByPlaceholder('Your password').fill(PW)
  await page.getByRole('button', { name: /^delete account$/i }).click()
  await expect(codeDialog(page)).toHaveCount(1)
  const done = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname === '/api/v1/auth/account',
  )
  await codeDialog(page).getByLabel('Code').fill(backupCodes[0])
  await codeDialog(page).getByRole('button', { name: /^delete account$/i }).click()
  expect((await done).status()).toBe(200)
  expect(deletes.length).toBe(2)
  expect(deletes[1]).toEqual({ confirmation: 'DELETE', code: backupCodes[0] })
  expect(backupCodes[0]).toMatch(/^\d{8}$/)
  await page.waitForURL(/\/login/, { timeout: 15_000 })
  await expect(page).toHaveURL(/\/login/)
  await page.screenshot({ path: shotPath('04-2fa-deleted-with-backup-code.png') })
})

test('account without 2FA: no code field, the delete body is unchanged', async ({ page }) => {
  test.setTimeout(240_000)
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  await signupAndUnlock(page, { email: uniqueEmail('b16-no2fa'), password: PW })
  const deletes = trackDeletes(page)

  // Hold the DELETE in flight so the page can be shown at the moment it is sent.
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/v1/auth/account', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    await held
    await route.continue()
  })
  await startDelete(page)
  await expect.poll(() => deletes.length).toBe(1)
  expect(deletes[0]).toEqual({ confirmation: 'DELETE' })
  await expect(codeDialog(page)).toHaveCount(0)
  await expect(page.getByLabel('Code')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Deleting...' })).toHaveCount(1)
  await page.screenshot({ path: shotPath('05-no2fa-sent-without-code.png') })

  const done = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname === '/api/v1/auth/account',
  )
  release()
  expect((await done).status()).toBe(200)
  await page.waitForURL(/\/login/, { timeout: 15_000 })
  expect(deletes.length).toBe(1)
  await page.screenshot({ path: shotPath('06-no2fa-deleted.png') })
})

