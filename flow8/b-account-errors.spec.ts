import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import crypto from 'crypto'
import { signupAndUnlock, uniqueEmail } from '../e2e/helpers/signup'
const E = '/private/tmp/claude-501/-Users-guuslangelaar-Development-Beebeeb-beebeeb-io/cc7eef98-55fc-4493-9ff2-638c99aac79f/scratchpad/flow-8'
const PW = 'Correct-Horse-Battery-Staple-42'
const PW2 = 'Another-Long-Unbreached-Pass-77'

function totp(secretB32: string, offsetSteps = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = secretB32.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()
  let bits = ''
  for (const c of clean) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const key = Buffer.from(bytes)
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter % 2 ** 32, 4)
  const h = crypto.createHmac('sha1', key).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
  return code
}

async function snap(page: Page, name: string) {
  fs.writeFileSync(`${E}/${name}.txt`, await page.locator('body').innerText())
  await page.screenshot({ path: `${E}/${name}.png` })
}

test('account error-path walk', async ({ page, browser }) => {
  const email = uniqueEmail('flow8b')
  fs.writeFileSync(E + '/acct-b.txt', email)
  await page.context().route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  await page.goto('/signup?nodev=1')
  const acct = await signupAndUnlock(page, { email, password: PW })

  // 1. change password -> email
  await page.goto('/settings/security')
  await page.getByRole('button', { name: /^change password$/i }).click()
  const dialog = page.getByRole('dialog', { name: /change password/i })
  await dialog.getByLabel(/current password/i).fill(PW)
  await dialog.getByLabel(/^new password$/i).fill(PW2)
  await dialog.getByLabel(/confirm new password/i).fill(PW2)
  await dialog.getByRole('button', { name: /^change password$/i }).click()
  await page.waitForTimeout(8000)
  await snap(page, 'web-10-password-changed')

  // 2. enable 2FA; first try a wrong code at setup
  await page.goto('/settings/security')
  await page.getByRole('button', { name: /^set up$/i }).click()
  const secretEl = page.locator('code.font-mono').first()
  await expect(secretEl).toBeVisible({ timeout: 15_000 })
  let secret = (await secretEl.innerText()).trim()
  await page.getByPlaceholder('6-digit code').fill('000000')
  await page.getByRole('button', { name: /^verify$/i }).click()
  await page.waitForTimeout(2000)
  await snap(page, 'web-11-2fa-setup-wrong-code')
  fs.writeFileSync(E + '/web-11-url.txt', page.url())
  await page.goto('/settings/security')
  await page.getByRole('button', { name: /^set up$/i }).click()
  await expect(secretEl).toBeVisible({ timeout: 15_000 })
  const secret2 = (await secretEl.innerText()).trim()
  fs.writeFileSync(E + '/web-11b-secret-rotated.txt', String(secret2 !== secret))
  secret = secret2
  await page.getByPlaceholder('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: /^verify$/i }).click()
  await page.waitForTimeout(3000)
  await snap(page, 'web-12-2fa-backup-codes')
  const done = page.getByRole('button', { name: /I've saved these codes/i })
  if (await done.isVisible()) await done.click()

  // 3. second device: login + wrong 2FA code
  const ctx = await browser.newContext()
  await ctx.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  const p2 = await ctx.newPage()
  await p2.goto('/login?nodev=1')
  await p2.getByPlaceholder('you@example.com').fill(email)
  await p2.getByPlaceholder('Your password').last().fill(PW2)
  await p2.locator('button[type=submit]').first().click()
  const codeInput = p2.getByLabel('6-digit verification code')
  await expect(codeInput).toBeAttached({ timeout: 20_000 })
  await snap(p2, 'web-13-2fa-prompt')
  const wrong = totp(secret) === '123456' ? '654321' : '123456'
  await codeInput.fill(wrong)
  await p2.waitForTimeout(4000)
  await snap(p2, 'web-14-2fa-wrong-code-login')
  await ctx.close()

  // 4. network down: go offline and try to open a folder / upload
  await page.goto('/')
  await expect(page.getByText(/All files/i).first()).toBeVisible({ timeout: 15_000 })
  await page.context().setOffline(true)
  const fp = `${E}/offline-upload.txt`
  fs.writeFileSync(fp, 'offline test\n')
  const input = page.locator('input[type=file]').first()
  await input.setInputFiles(fp).catch(() => {})
  await page.waitForTimeout(8000)
  await snap(page, 'web-15-offline-upload')
  await page.reload().catch(() => {})
  await page.waitForTimeout(3000)
  await snap(page, 'web-16-offline-reload')
  await page.context().setOffline(false)

  fs.writeFileSync(E + '/acct-b-phrase.txt', acct.recoveryPhrase)
})
